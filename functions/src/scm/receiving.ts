import type { z } from 'zod';
import {
  CreateGateEntryInput, PostGRNInput, PostLandedCostInput, PostPurchaseReturnInput, PostPutawayInput, PostQCInput,
} from '@texafashions/types';
import { landedCost, splitGst, suggestBin, type BinInfo } from '@texafashions/domain';
import { FieldValue, col, db, type Caller } from '../admin';
import { StockEngine, audit, fail, getMasterDocs, must, requireLocation, requireRoles, reserveNumber } from '../engine';
import { HttpsError } from 'firebase-functions/v2/https';

type Doc = Record<string, any>;
const WH = 'WH-CENTRAL';

/** Keyword-based stand-in for the AI defect tagger (a Claude-vision call replaces this in Phase 7). */
export function tagDefect(reason?: string | null, note?: string | null): string {
  const t = `${reason ?? ''} ${note ?? ''}`.toLowerCase();
  const map: [string, RegExp][] = [['stitching', /stitch|seam|thread|tear|rip/], ['colour', /colou?r|fade|stain|dye/], ['broken', /broke|crack|snap|dent|bent/], ['leak', /leak|spill/], ['missing-parts', /missing|incomplete|short/], ['packaging', /pack|box|wrap|seal/]];
  return map.find(([, r]) => r.test(t))?.[0] ?? 'other';
}

export async function createGateEntry(c: Caller, input: z.output<typeof CreateGateEntryInput>) {
  requireRoles(c, 'warehouse_manager', 'buyer');
  const ref = col('gateEntries').doc();
  const vendor = must((await col('vendors').doc(input.vendorId).get()).data() as Doc | undefined, 'Vendor not found');
  const po = input.poId ? ((await col('purchaseOrders').doc(input.poId).get()).data() as Doc | undefined) : undefined;
  if (input.poId && !po) fail('PO not found');
  if (po && po.vendorId !== input.vendorId) fail('Vendor does not match the PO');
  return db.runTransaction(async (tx) => {
    const num = await reserveNumber(tx, 'GATE', input.locationId); num.write();
    tx.set(ref, { number: num.number, ...Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v ?? null])), vendorName: vendor.name, poNumber: po?.number ?? null, status: 'at_gate', arrivedAt: FieldValue.serverTimestamp(), createdBy: c.uid, createdByName: c.name });
    audit(tx, c, { action: 'gate_entry', entity: 'gateEntries', entityId: ref.id, before: null, after: { number: num.number, vehicleNo: input.vehicleNo } });
    return { id: ref.id, number: num.number };
  });
}

const RECEIVABLE = ['approved', 'sent', 'acknowledged', 'partially_received'];

export async function postGRN(c: Caller, input: z.output<typeof PostGRNInput>) {
  requireRoles(c, 'warehouse_manager');
  requireLocation(c, input.locationId);
  const grnRef = col('grns').doc();
  const qcRef = col('qcInspections').doc(grnRef.id);
  const poRef = col('purchaseOrders').doc(input.poId);
  return db.runTransaction(async (tx) => {
    const poSnap = await tx.get(poRef);
    const po = must(poSnap.exists ? (poSnap.data() as Doc) : null, 'PO not found');
    if (!RECEIVABLE.includes(po.status)) fail(`PO is ${po.status}; goods can be received once it is approved`);
    const asn = input.asnId ? (await tx.get(col('asns').doc(input.asnId))).data() as Doc | undefined : undefined;
    const num = await reserveNumber(tx, 'GRN', input.locationId);
    const eng = await StockEngine.load(tx, input.lines.map((l) => [input.locationId, l.skuId]));
    const poLines = new Map((po.lines as Doc[]).map((l) => [l.skuId, l]));
    const asnQty = new Map(((asn?.lines ?? []) as Doc[]).map((l) => [l.skuId, l.qty as number]));
    const seen = new Set<string>();
    const grnLines = input.lines.filter((l) => l.receivedQty > 0 || l.damagedQty > 0).map((l) => {
      if (seen.has(l.skuId)) fail(`${l.skuId} appears twice`); seen.add(l.skuId);
      const p = poLines.get(l.skuId); if (!p) fail(`${l.skuId} is not on PO ${po.number}`);
      if (l.damagedQty > l.receivedQty) fail(`${l.skuId}: damaged qty exceeds received qty`);
      const open = p.qty - p.receivedQty;
      const expected = asn ? Math.min(open, asnQty.get(l.skuId) ?? 0) : open;
      const excess = Math.max(0, l.receivedQty - open);
      if (excess > Math.ceil(p.qty * 0.05)) fail(`${l.skuId}: over-receipt of ${excess} exceeds the 5% tolerance — raise a PO amendment first`);
      const good = l.receivedQty - l.damagedQty;
      const short = Math.max(0, expected - l.receivedQty);
      if (good > 0) eng.move({ locationId: input.locationId, skuId: l.skuId, bucket: 'inQC', qty: good, kind: 'receipt', unitCostPaise: p.unitCostPaise, refType: 'grn', refId: grnRef.id, reason: 'GRN good' });
      if (l.damagedQty > 0) eng.move({ locationId: input.locationId, skuId: l.skuId, bucket: 'damaged', qty: l.damagedQty, kind: 'receipt', refType: 'grn', refId: grnRef.id, reason: 'Damaged at receipt' });
      return { skuId: l.skuId, name: p.name, orderedQty: p.qty, openQtyBefore: open, expectedQty: expected, receivedQty: l.receivedQty, damagedQty: l.damagedQty, goodQty: good, shortQty: short, excessQty: excess, unitCostPaise: p.unitCostPaise, unitPriceMinor: p.unitPriceMinor, acceptedQty: 0, rejectedQty: 0, reworkQty: 0 };
    });
    if (!grnLines.length) fail('Nothing received');
    const newLines = (po.lines as Doc[]).map((l) => { const g = grnLines.find((x) => x.skuId === l.skuId); return g ? { ...l, receivedQty: l.receivedQty + g.receivedQty } : l; });
    const allDone = newLines.every((l) => l.receivedQty >= l.qty);
    num.write(); eng.commit(tx, c);
    const hasVariance = grnLines.some((l) => l.shortQty || l.excessQty || l.damagedQty);
    tx.set(grnRef, { number: num.number, poId: input.poId, poNumber: po.number, vendorId: po.vendorId, vendorName: po.vendorName, locationId: input.locationId, gateEntryId: input.gateEntryId ?? null, asnId: input.asnId ?? null, lines: grnLines, hasVariance, status: 'pending_qc', notes: input.notes ?? null, createdBy: c.uid, createdByName: c.name, createdAt: FieldValue.serverTimestamp() });
    tx.set(qcRef, { grnId: grnRef.id, grnNumber: num.number, poId: input.poId, poNumber: po.number, vendorId: po.vendorId, locationId: input.locationId, status: 'pending', createdAt: FieldValue.serverTimestamp() });
    tx.update(poRef, { lines: newLines, status: allDone ? 'received' : 'partially_received', 'flow.GRN': { id: grnRef.id, number: num.number } });
    if (input.gateEntryId) tx.update(col('gateEntries').doc(input.gateEntryId), { status: 'grn_done', grnId: grnRef.id, grnNumber: num.number });
    if (input.asnId) tx.update(col('asns').doc(input.asnId), { status: 'received', grnId: grnRef.id });
    audit(tx, c, { action: 'post_grn', entity: 'grns', entityId: grnRef.id, before: null, after: { number: num.number, lines: grnLines.length, hasVariance } });
    return { id: grnRef.id, number: num.number, hasVariance, status: allDone ? 'received' : 'partially_received' };
  });
}

async function binUsage(): Promise<BinInfo[]> {
  const [bins, stock] = await Promise.all([col('bins').where('warehouseId', '==', WH).get(), col('stock').where('locationId', '==', WH).get()]);
  const used = new Map<string, number>();
  stock.docs.forEach((s) => Object.entries((s.get('bins') ?? {}) as Record<string, number>).forEach(([b, q]) => used.set(b, (used.get(b) ?? 0) + q)));
  return bins.docs.filter((b) => b.get('status') !== 'inactive').map((b) => ({ id: b.id, capacityUnits: b.get('capacityUnits') ?? 0, departmentId: b.get('departmentId') ?? undefined, used: used.get(b.id) ?? 0 }));
}

export async function postQC(c: Caller, input: z.output<typeof PostQCInput>) {
  requireRoles(c, 'warehouse_manager');
  const grnRef = col('grns').doc(input.grnId);
  const qcRef = col('qcInspections').doc(input.grnId);
  const [bins, skus] = await Promise.all([binUsage(), getMasterDocs<Doc>('skus', input.lines.map((l) => l.skuId))]);
  const returnRef = col('purchaseReturns').doc();
  const dnRef = col('debitNotes').doc();
  return db.runTransaction(async (tx) => {
    const grnSnap = await tx.get(grnRef);
    const grn = must(grnSnap.exists ? (grnSnap.data() as Doc) : null, 'GRN not found');
    if (!['pending_qc', 'rework'].includes(grn.status)) fail(`GRN is ${grn.status}`);
    const poRef = col('purchaseOrders').doc(grn.poId);
    const po = (await tx.get(poRef)).data() as Doc;
    const vendor = (await tx.get(col('vendors').doc(grn.vendorId))).data() as Doc | undefined;
    const retNum = await reserveNumber(tx, 'PRT', grn.locationId);
    const eng = await StockEngine.load(tx, input.lines.map((l) => [grn.locationId, l.skuId]));
    const byInput = new Map(input.lines.map((l) => [l.skuId, l]));
    const poLines = (po.lines as Doc[]).map((l) => ({ ...l }));
    const tasks: Doc[] = []; const rejects: Doc[] = []; const usedNow = new Map<string, number>();
    const lines = (grn.lines as Doc[]).map((g) => {
      const q = byInput.get(g.skuId);
      const remaining = g.goodQty - g.acceptedQty - g.rejectedQty;
      if (!q) { if (remaining > 0) fail(`${g.skuId}: ${remaining} units still need inspection`); return g; }
      if (q.passQty + q.rejectQty + q.reworkQty !== remaining) fail(`${g.skuId}: pass+reject+rework must equal the ${remaining} units awaiting inspection`);
      if (q.rejectQty > 0 && !q.reasonCode) fail(`${g.skuId}: a reason code is required for rejects`);
      if (q.passQty) eng.move({ locationId: grn.locationId, skuId: g.skuId, bucket: 'inQC', qty: -q.passQty, kind: 'move', refType: 'qc', refId: input.grnId, reason: 'QC pass' });
      if (q.passQty) { eng.move({ locationId: grn.locationId, skuId: g.skuId, bucket: 'onHand', qty: q.passQty, kind: 'move', refType: 'qc', refId: input.grnId, reason: 'QC pass' }); eng.setField(grn.locationId, g.skuId, 'unputaway', (eng.get(grn.locationId, g.skuId).unputaway ?? 0) + q.passQty); }
      if (q.rejectQty) { eng.move({ locationId: grn.locationId, skuId: g.skuId, bucket: 'inQC', qty: -q.rejectQty, kind: 'move', refType: 'qc', refId: input.grnId, reason: 'QC reject' }); eng.move({ locationId: grn.locationId, skuId: g.skuId, bucket: 'damaged', qty: q.rejectQty, kind: 'move', refType: 'qc', refId: input.grnId, reason: 'QC reject' }); }
      const pl = poLines.find((l) => l.skuId === g.skuId)!;
      pl.acceptedQty = (pl.acceptedQty ?? 0) + q.passQty;
      if (q.passQty) {
        const sku = skus.get(g.skuId);
        const bin = suggestBin(bins.map((b) => ({ ...b, used: b.used + (usedNow.get(b.id) ?? 0) })), sku?.departmentId, q.passQty);
        if (bin) usedNow.set(bin, (usedNow.get(bin) ?? 0) + q.passQty);
        tasks.push({ grnId: input.grnId, grnNumber: grn.number, poId: grn.poId, skuId: g.skuId, name: g.name, qty: q.passQty, qtyDone: 0, suggestedBinId: bin, barcode: sku?.barcode ?? null, status: 'pending', locationId: grn.locationId });
      }
      if (q.rejectQty) rejects.push({ skuId: g.skuId, name: g.name, qty: q.rejectQty, unitCostPaise: g.unitCostPaise, unitPriceMinor: g.unitPriceMinor, gstRate: pl.gstRate, reasonCode: q.reasonCode, defectNote: q.defectNote ?? null, defectTag: tagDefect(q.reasonCode, q.defectNote), photoPaths: q.photoPaths ?? [] });
      return { ...g, acceptedQty: g.acceptedQty + q.passQty, rejectedQty: g.rejectedQty + q.rejectQty, reworkQty: q.reworkQty, qcNote: q.defectNote ?? null, photoPaths: [...(g.photoPaths ?? []), ...(q.photoPaths ?? [])] };
    });
    const pendingRework = lines.some((l) => (l as Doc).reworkQty > 0);
    const done = lines.every((l) => (l as Doc).goodQty - (l as Doc).acceptedQty - (l as Doc).rejectedQty === 0);
    const status = done ? 'done' : pendingRework ? 'rework' : 'pending_qc';
    if (rejects.length) {
      const intra = !!po.intraState;
      let value = 0, tax = 0;
      rejects.forEach((r) => { const v = r.qty * r.unitCostPaise; value += v; tax += po.type === 'domestic' ? splitGst(v, r.gstRate, intra).totalTaxPaise : 0; });
      retNum.write();
      tx.set(returnRef, { number: retNum.number, grnId: input.grnId, grnNumber: grn.number, poId: grn.poId, poNumber: grn.poNumber, vendorId: grn.vendorId, vendorName: grn.vendorName, lines: rejects, valuePaise: value, taxPaise: tax, totalPaise: value + tax, status: 'draft', autoDrafted: true, createdBy: c.uid, createdAt: FieldValue.serverTimestamp() });
      tx.set(dnRef, { returnId: returnRef.id, returnNumber: retNum.number, poId: grn.poId, poNumber: grn.poNumber, vendorId: grn.vendorId, vendorName: grn.vendorName, amountPaise: value + tax, taxableValuePaise: value, taxPaise: tax, reason: 'QC rejection', status: 'draft', applied: false, createdAt: FieldValue.serverTimestamp() });
    }
    eng.commit(tx, c);
    tasks.forEach((t) => tx.set(col('putawayTasks').doc(), { ...t, createdAt: FieldValue.serverTimestamp() }));
    tx.update(grnRef, { lines, status });
    tx.update(qcRef, { status: done ? 'done' : status, lines: input.lines, inspectedBy: c.uid, inspectedByName: c.name, inspectedAt: FieldValue.serverTimestamp(), returnId: rejects.length ? returnRef.id : null });
    tx.update(poRef, { lines: poLines, 'flow.QC': { id: input.grnId, number: grn.number } });
    audit(tx, c, { action: 'post_qc', entity: 'qcInspections', entityId: input.grnId, before: null, after: { status, passed: tasks.reduce((a, t) => a + t.qty, 0), rejected: rejects.reduce((a, r) => a + r.qty, 0) } });
    void vendor;
    return { status, putawayTasks: tasks.length, returnId: rejects.length ? returnRef.id : null, returnNumber: rejects.length ? retNum.number : null };
  });
}

export async function postPutaway(c: Caller, input: z.output<typeof PostPutawayInput>) {
  requireRoles(c, 'warehouse_manager');
  const taskRef = col('putawayTasks').doc(input.taskId);
  const [binSnap, bins] = await Promise.all([col('bins').doc(input.binId).get(), binUsage()]);
  if (!binSnap.exists || binSnap.get('status') === 'inactive') fail('Unknown bin');
  if (binSnap.get('warehouseId') !== WH) fail('Bin is not in the central warehouse');
  return db.runTransaction(async (tx) => {
    const t = must((await tx.get(taskRef)).data() as Doc | undefined, 'Task not found');
    if (t.status === 'done') fail('Task already done');
    const qty = input.qty ?? t.qty - t.qtyDone;
    if (qty > t.qty - t.qtyDone) fail(`Only ${t.qty - t.qtyDone} units left on this task`);
    const info = bins.find((b) => b.id === input.binId)!;
    if (info.used + qty > info.capacityUnits) fail(`Bin ${input.binId} has only ${info.capacityUnits - info.used} units of room`);
    const eng = await StockEngine.load(tx, [[t.locationId, t.skuId]]);
    eng.putaway(t.locationId, t.skuId, input.binId, qty, input.taskId);
    eng.commit(tx, c);
    const done = t.qtyDone + qty >= t.qty;
    tx.update(taskRef, { qtyDone: t.qtyDone + qty, status: done ? 'done' : 'partial', binId: input.binId, doneBy: c.uid, doneAt: FieldValue.serverTimestamp() });
    audit(tx, c, { action: 'putaway', entity: 'putawayTasks', entityId: input.taskId, before: null, after: { binId: input.binId, qty } });
    return { status: done ? 'done' : 'partial', label: { skuId: t.skuId, name: t.name, barcode: t.barcode, binId: input.binId, qty } };
  });
}

export async function postPurchaseReturn(c: Caller, input: z.output<typeof PostPurchaseReturnInput>) {
  requireRoles(c, 'warehouse_manager', 'cfo');
  const retRef = col('purchaseReturns').doc(input.returnId);
  return db.runTransaction(async (tx) => {
    const ret = must((await tx.get(retRef)).data() as Doc | undefined, 'Return not found');
    if (ret.status !== 'draft') fail(`Return is ${ret.status}`);
    const dnSnap = await col('debitNotes').where('returnId', '==', input.returnId).limit(1).get();
    const dn = dnSnap.docs[0]; if (!dn) fail('Debit note draft missing');
    const num = await reserveNumber(tx, 'DN', WH);
    const eng = await StockEngine.load(tx, (ret.lines as Doc[]).map((l) => [WH, l.skuId]));
    for (const l of ret.lines as Doc[]) eng.move({ locationId: WH, skuId: l.skuId, bucket: 'damaged', qty: -l.qty, kind: 'issue', refType: 'purchase_return', refId: input.returnId, reason: `Returned to ${ret.vendorName}` });
    num.write(); eng.commit(tx, c);
    tx.update(retRef, { status: 'dispatched', dispatchedBy: c.uid, dispatchedAt: FieldValue.serverTimestamp(), debitNoteNumber: num.number });
    tx.update(dn.ref, { status: 'issued', number: num.number, issuedAt: FieldValue.serverTimestamp(), issuedBy: c.uid });
    audit(tx, c, { action: 'post_purchase_return', entity: 'purchaseReturns', entityId: input.returnId, before: { status: 'draft' }, after: { debitNote: num.number, totalPaise: ret.totalPaise } });
    return { debitNoteNumber: num.number, totalPaise: ret.totalPaise };
  });
}

export async function postLandedCost(c: Caller, input: z.output<typeof PostLandedCostInput>) {
  requireRoles(c, 'cfo', 'warehouse_manager', 'buyer');
  const lcRef = col('landedCosts').doc();
  const boe = input.boeId ? ((await col('billsOfEntry').doc(input.boeId).get()).data() as Doc | undefined) : undefined;
  if (input.boeId && !boe) fail('Bill of Entry not found');
  return db.runTransaction(async (tx) => {
    const poRef = col('purchaseOrders').doc(input.poId);
    const [poSnap, ...grnSnaps] = await tx.getAll(poRef, ...input.grnIds.map((id) => col('grns').doc(id)));
    const po = must(poSnap!.exists ? (poSnap!.data() as Doc) : null, 'PO not found');
    const grns = grnSnaps.map((s) => must<Doc>(s.exists ? ({ ...(s.data() as Doc), id: s.id } as Doc) : null, 'GRN not found'));
    grns.forEach((g) => { if (g.poId !== input.poId) fail(`GRN ${g.number} belongs to another PO`); if (g.landedCostId) fail(`GRN ${g.number} already has landed cost applied`); });
    const key = (g: Doc, l: Doc) => `${g.id}|${l.skuId}`;
    const items = grns.flatMap((g) => (g.lines as Doc[]).filter((l) => l.goodQty > 0).map((l) => ({ g, l, weight: (po.lines as Doc[]).find((p) => p.skuId === l.skuId)?.weightGrams ?? undefined })));
    if (!items.length) fail('No received goods to cost');
    const charges = [...input.charges];
    if (boe) {
      charges.push({ type: 'customs (BCD+SWS)', amountPaise: boe.landedAddPaise }, { type: 'CHA charges', amountPaise: boe.chaChargesPaise }, { type: 'other import charges', amountPaise: boe.otherChargesPaise });
    }
    const res = landedCost(items.map((i) => ({ key: key(i.g, i.l), qty: i.l.goodQty, valuePaise: i.l.goodQty * i.l.unitCostPaise, weightGrams: i.weight })), charges.filter((x) => x.amountPaise > 0), input.basis);
    const eng = await StockEngine.load(tx, items.map((i) => [i.g.locationId, i.l.skuId] as [string, string]), { ignoreLock: true });
    res.lines.forEach((r, i) => { if (r.allocatedPaise) eng.revalue(items[i]!.g.locationId, items[i]!.l.skuId, r.allocatedPaise, 'landed_cost', lcRef.id); });
    // IGST: import → IGST paid at customs; domestic → GST on invoice. Both are input credit, never cost.
    const igstCredit = boe ? boe.igstPaise : (po.type === 'domestic' ? po.taxPaise : 0);
    eng.commit(tx, c);
    grns.forEach((g) => tx.update(col('grns').doc(g.id), { landedCostId: lcRef.id }));
    tx.set(lcRef, {
      poId: input.poId, poNumber: po.number, grnIds: input.grnIds, boeId: input.boeId ?? null, basis: input.basis, charges, totalChargesPaise: res.totalChargesPaise,
      lines: res.lines.map((r, i) => ({ ...r, skuId: items[i]!.l.skuId, grnId: items[i]!.g.id, qty: items[i]!.l.goodQty })), igstCreditPaise: igstCredit, createdBy: c.uid, createdByName: c.name, createdAt: FieldValue.serverTimestamp(),
    });
    audit(tx, c, { action: 'post_landed_cost', entity: 'landedCosts', entityId: lcRef.id, before: null, after: { totalChargesPaise: res.totalChargesPaise, basis: input.basis, igstCreditPaise: igstCredit } });
    return { id: lcRef.id, totalChargesPaise: res.totalChargesPaise, igstCreditPaise: igstCredit };
  });
}
void HttpsError;
