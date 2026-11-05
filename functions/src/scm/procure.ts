import { HttpsError } from 'firebase-functions/v2/https';
import type { Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import {
  AckPOInput, AmendPOInput, AwardRFQInput, ConvertSuggestionsInput, CreateASNInput, CreatePOInput, CreatePRInput, CreateRFQInput,
  DecideDocInput, RecordProformaInput, RunReplenishmentInput, SaveBoEInput, SendPOInput, SubmitQuotationInput, type FlowState,
} from '@texafashions/types';
import { importDuty, isIntraState, mayApprove, routeApproval, splitGst, suggestReplenishment, toInrPaise } from '@texafashions/domain';
import { FieldValue, col, db, type Caller } from '../admin';
import { StockEngine, fail, getMasterDocs, loadMatrix, must, requireLocation, requireRoles, reserveNumber, audit, ymd } from '../engine';
import { applyPaymentEffects } from './payables';
import { applyAdjustmentEffects } from '../inventory';

type Doc = Record<string, any>;
const BUYING = ['buyer', 'store_manager', 'warehouse_manager', 'cfo'] as const;

// ───────────────────────── Replenishment
export const SYSTEM: Caller = { uid: 'system', name: 'Scheduler', claims: { role: 'super_admin', storeIds: [], approvalLimitPaise: 0 } };

export async function runReplenishmentCore(c: Caller, input: z.output<typeof RunReplenishmentInput>) {
  const onlyLoc = input.storeId ?? null;
  const stockSnap = onlyLoc ? await col('stock').where('locationId', '==', onlyLoc).get() : await col('stock').get();
  const stock = stockSnap.docs.map((d) => d.data() as Doc);
  const skuIds = [...new Set(stock.map((s) => s.skuId as string))];
  const skus = await getMasterDocs<Doc>('skus', skuIds);
  // open PO remaining qty (on order to the warehouse) and open PR qty per location+sku
  const pos = await col('purchaseOrders').where('status', 'in', ['approved', 'sent', 'acknowledged', 'partially_received']).get();
  const onOrderWh = new Map<string, number>();
  pos.docs.forEach((p) => (p.get('lines') as Doc[]).forEach((l) => onOrderWh.set(l.skuId, (onOrderWh.get(l.skuId) ?? 0) + Math.max(0, l.qty - l.receivedQty))));
  const prs = await col('purchaseRequisitions').where('status', '==', 'approved').get();
  const onOrderPr = new Map<string, number>();
  prs.docs.forEach((p) => (p.get('lines') as Doc[]).forEach((l) => onOrderPr.set(`${p.get('storeId')}_${l.skuId}`, (onOrderPr.get(`${p.get('storeId')}_${l.skuId}`) ?? 0) + l.qty)));
  const whStock = new Map(stock.filter((s) => s.locationId === 'WH-CENTRAL').map((s) => [s.skuId as string, s]));
  const demandBySku = new Map<string, number>();
  stock.filter((s) => s.locationId !== 'WH-CENTRAL').forEach((s) => demandBySku.set(s.skuId, (demandBySku.get(s.skuId) ?? 0) + (s.dailyDemand ?? 0)));

  const out: { id: string; data: Doc }[] = [];
  for (const s of stock) {
    const sku = skus.get(s.skuId); if (!sku || sku.status === 'inactive') continue;
    const isWh = s.locationId === 'WH-CENTRAL';
    const mm = sku.minMaxByStore?.[s.locationId];
    const r = suggestReplenishment({
      dailyDemand: isWh ? demandBySku.get(s.skuId) ?? 0 : s.dailyDemand ?? 0, onHand: s.onHand + (isWh ? s.inQC : 0),
      onOrder: isWh ? onOrderWh.get(s.skuId) ?? 0 : onOrderPr.get(`${s.locationId}_${s.skuId}`) ?? 0, inTransit: s.inTransit,
      min: isWh ? undefined : mm?.min, max: isWh ? undefined : mm?.max, leadTimeDays: isWh ? 30 : 4,
    });
    if (r.suggestQty <= 0) continue;
    const whAvail = whStock.get(s.skuId)?.onHand ?? 0;
    out.push({
      id: `${s.locationId}_${s.skuId}`,
      data: {
        locationId: s.locationId, skuId: s.skuId, name: sku.name, departmentId: sku.departmentId ?? null, suggestQty: r.suggestQty, reorderPoint: r.reorderPoint, targetStock: r.targetStock,
        onHand: s.onHand, onOrder: r.position - s.onHand - s.inTransit, inTransit: s.inTransit, dailyDemand: Math.round((s.dailyDemand ?? 0) * 100) / 100, daysOfCover: r.daysOfCover,
        urgency: r.urgency, reason: r.reason, source: isWh ? 'vendor' : whAvail >= r.suggestQty ? 'warehouse' : 'vendor', estCostPaise: r.suggestQty * (sku.costPaise ?? 0),
        status: 'open', runAt: FieldValue.serverTimestamp(), runBy: c.name,
      },
    });
  }
  // replace previous open suggestions in scope
  const prev = await (onlyLoc ? col('replenishmentSuggestions').where('locationId', '==', onlyLoc) : col('replenishmentSuggestions')).where('status', '==', 'open').get();
  const keep = new Set(out.map((o) => o.id));
  const del = prev.docs.filter((d) => !keep.has(d.id));
  const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [
    ...out.map((o) => (b: FirebaseFirestore.WriteBatch) => b.set(col('replenishmentSuggestions').doc(o.id), o.data)),
    ...del.map((d) => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)),
  ];
  for (let i = 0; i < ops.length; i += 400) { const b = db.batch(); ops.slice(i, i + 400).forEach((f) => f(b)); await b.commit(); }
  const b = db.batch();
  audit(b, c, { action: 'run_replenishment', entity: 'replenishmentSuggestions', entityId: onlyLoc ?? 'ALL', before: null, after: { suggestions: out.length, removed: del.length } });
  await b.commit();
  return { suggestions: out.length, removed: del.length, critical: out.filter((o) => o.data.urgency === 'critical').length };
}
export const runReplenishment = async (c: Caller, i: z.output<typeof RunReplenishmentInput>) => {
  requireRoles(c, 'buyer', 'warehouse_manager', 'store_manager');
  if (i.storeId) requireLocation(c, i.storeId);
  return runReplenishmentCore(c, i);
};

// ───────────────────────── Purchase requisition
async function skuCosts(ids: string[]) { const m = await getMasterDocs<Doc>('skus', ids); return m; }

export async function createPR(c: Caller, input: z.output<typeof CreatePRInput>) {
  requireRoles(c, ...BUYING);
  requireLocation(c, input.storeId);
  const skus = await skuCosts(input.lines.map((l) => l.skuId));
  const lines = input.lines.map((l) => { const s = must(skus.get(l.skuId), `Unknown SKU ${l.skuId}`); return { skuId: l.skuId, name: s.name, qty: l.qty, estCostPaise: s.costPaise ?? 0, note: l.note ?? null }; });
  const total = lines.reduce((a, l) => a + l.qty * l.estCostPaise, 0);
  const matrix = await loadMatrix();
  const route = routeApproval('PR', total, matrix, { role: c.claims.role, approvalLimitPaise: c.claims.approvalLimitPaise });
  const ref = col('purchaseRequisitions').doc();
  const sugRefs = (input.suggestionIds ?? []).map((id) => col('replenishmentSuggestions').doc(id));
  return db.runTransaction(async (tx) => {
    const num = await reserveNumber(tx, 'PR', input.storeId);
    num.write();
    tx.set(ref, {
      number: num.number, storeId: input.storeId, lines, totalPaise: total, status: route.autoApprove ? 'approved' : 'pending_approval', approverRole: route.approverRole,
      neededBy: input.neededBy ?? null, notes: input.notes ?? null, requestedBy: c.uid, requestedByName: c.name, createdAt: FieldValue.serverTimestamp(),
      ...(route.autoApprove ? { approvedBy: c.uid, approvedByName: c.name + ' (auto, within authority)', approvedAt: FieldValue.serverTimestamp() } : {}),
    });
    sugRefs.forEach((r) => tx.set(r, { status: 'converted', prId: ref.id, prNumber: num.number }, { merge: true }));
    audit(tx, c, { action: 'create_pr', entity: 'purchaseRequisitions', entityId: ref.id, before: null, after: { number: num.number, totalPaise: total, status: route.autoApprove ? 'approved' : 'pending_approval' } });
    return { id: ref.id, number: num.number, status: route.autoApprove ? 'approved' : 'pending_approval', approverRole: route.approverRole };
  });
}
export async function convertSuggestions(c: Caller, input: z.output<typeof ConvertSuggestionsInput>) {
  const snaps = await db.getAll(...input.suggestionIds.map((id) => col('replenishmentSuggestions').doc(id)));
  const lines = snaps.map((s) => must(s.exists ? (s.data() as Doc) : null, 'Suggestion not found')).filter((s) => s.status === 'open' && s.locationId === input.storeId).map((s) => ({ skuId: s.skuId as string, qty: s.suggestQty as number, note: s.reason as string }));
  if (!lines.length) fail('No open suggestions for that location');
  return createPR(c, { storeId: input.storeId, lines, suggestionIds: input.suggestionIds, notes: 'Converted from replenishment suggestions' });
}

// ───────────────────────── RFQ + quotations
export async function createRFQ(c: Caller, input: z.output<typeof CreateRFQInput>) {
  requireRoles(c, 'buyer');
  const pr = must((await col('purchaseRequisitions').doc(input.prId).get()).data() as Doc | undefined, 'PR not found');
  if (pr.status !== 'approved') fail('PR must be approved before an RFQ');
  const vendors = await getMasterDocs<Doc>('vendors', input.vendorIds);
  if (vendors.size !== new Set(input.vendorIds).size) fail('Unknown vendor in list');
  const ref = col('rfqs').doc();
  return db.runTransaction(async (tx) => {
    const num = await reserveNumber(tx, 'RFQ', 'WH-CENTRAL'); num.write();
    tx.set(ref, { number: num.number, prId: input.prId, prNumber: pr.number, storeId: pr.storeId, lines: pr.lines.map((l: Doc) => ({ skuId: l.skuId, name: l.name, qty: l.qty })), vendorIds: input.vendorIds, vendorNames: Object.fromEntries([...vendors].map(([id, v]) => [id, v.name])), dueDate: input.dueDate ?? null, status: 'open', createdBy: c.uid, createdAt: FieldValue.serverTimestamp() });
    tx.update(col('purchaseRequisitions').doc(input.prId), { rfqId: ref.id, rfqNumber: num.number });
    audit(tx, c, { action: 'create_rfq', entity: 'rfqs', entityId: ref.id, before: null, after: { vendors: input.vendorIds } });
    return { id: ref.id, number: num.number };
  });
}
async function fxRate(currency: string): Promise<number> {
  if (currency === 'INR') return 100;
  const fx = must((await col('fxRates').doc(`FX-${currency}`).get()).data() as Doc | undefined, `No FX rate for ${currency}`);
  return fx.ratePaisePerUnit as number;
}
export async function submitQuotation(c: Caller, input: z.output<typeof SubmitQuotationInput>) {
  requireRoles(c, 'buyer');
  const rfq = must((await col('rfqs').doc(input.rfqId).get()).data() as Doc | undefined, 'RFQ not found');
  if (rfq.status !== 'open') fail('RFQ is closed');
  if (!rfq.vendorIds.includes(input.vendorId)) fail('Vendor was not invited to this RFQ');
  const prices = new Map(input.lines.map((l) => [l.skuId, l.unitPriceMinor]));
  const missing = (rfq.lines as Doc[]).filter((l) => !prices.has(l.skuId));
  if (missing.length) fail(`Quote missing prices for ${missing.map((m) => m.skuId).join(', ')}`);
  const rate = await fxRate(input.currency);
  const totalMinor = (rfq.lines as Doc[]).reduce((a, l) => a + l.qty * prices.get(l.skuId)!, 0);
  const id = `${input.rfqId}_${input.vendorId}`;
  const b = db.batch();
  b.set(col('quotations').doc(id), {
    rfqId: input.rfqId, vendorId: input.vendorId, vendorName: rfq.vendorNames?.[input.vendorId] ?? input.vendorId, currency: input.currency, fxRatePaisePerUnit: rate,
    leadTimeDays: input.leadTimeDays, validTill: input.validTill ?? null, paymentTermsDays: input.paymentTermsDays ?? null, incoterm: input.incoterm ?? null,
    lines: input.lines, totalMinor, totalInrPaise: toInrPaise(totalMinor, rate), createdBy: c.uid, createdAt: FieldValue.serverTimestamp(),
  });
  audit(b, c, { action: 'submit_quotation', entity: 'quotations', entityId: id, before: null, after: { totalMinor, currency: input.currency } });
  await b.commit();
  return { id };
}
export async function awardRFQ(c: Caller, input: z.output<typeof AwardRFQInput>) {
  requireRoles(c, 'buyer');
  const rfqRef = col('rfqs').doc(input.rfqId);
  const rfq = must((await rfqRef.get()).data() as Doc | undefined, 'RFQ not found');
  if (rfq.status !== 'open') fail('RFQ already awarded');
  const q = must((await col('quotations').doc(`${input.rfqId}_${input.vendorId}`).get()).data() as Doc | undefined, 'No quotation from that vendor');
  const prices = new Map((q.lines as Doc[]).map((l) => [l.skuId, l.unitPriceMinor as number]));
  const res = await createPOCore(c, {
    vendorId: input.vendorId, type: q.currency === 'INR' ? 'domestic' : 'import', currency: q.currency, incoterm: q.incoterm, paymentTermsDays: q.paymentTermsDays,
    lines: (rfq.lines as Doc[]).map((l) => ({ skuId: l.skuId, qty: l.qty, unitPriceMinor: prices.get(l.skuId)! })), prId: rfq.prId, rfqId: input.rfqId,
    expectedDate: new Date(Date.now() + q.leadTimeDays * 86_400_000).toISOString().slice(0, 10),
  }, (tx) => tx.update(rfqRef, { status: 'awarded', awardedVendorId: input.vendorId, awardedAt: FieldValue.serverTimestamp() }));
  return res;
}

// ───────────────────────── Purchase order
interface Priced { lines: Doc[]; subtotalMinor: number; subtotalInrPaise: number; taxPaise: number; totalInrPaise: number; rate: number; intra: boolean }
async function priceLines(vendor: Doc, type: string, currency: string, lines: z.output<typeof CreatePOInput>['lines']): Promise<Priced> {
  const skus = await getMasterDocs<Doc>('skus', lines.map((l) => l.skuId));
  const rate = await fxRate(currency);
  const wh = (await col('warehouses').doc('WH-CENTRAL').get()).data() as Doc | undefined;
  const gst = wh?.gstinId ? ((await col('gstins').doc(wh.gstinId).get()).data() as Doc | undefined)?.gstin : undefined;
  const intra = isIntraState(vendor.gstin, gst);
  let subMinor = 0, subInr = 0, tax = 0;
  const out = lines.map((l) => {
    const s = must(skus.get(l.skuId), `Unknown SKU ${l.skuId}`);
    const lineMinor = l.qty * l.unitPriceMinor;
    const unitCostPaise = toInrPaise(l.unitPriceMinor, rate);
    const lineInr = toInrPaise(lineMinor, rate);
    const gstRate = type === 'domestic' ? Number(s.gstRate ?? 0) : 0;
    tax += splitGst(lineInr, gstRate, intra).totalTaxPaise;
    subMinor += lineMinor; subInr += lineInr;
    return { skuId: l.skuId, name: s.name, qty: l.qty, unitPriceMinor: l.unitPriceMinor, lineMinor, unitCostPaise, gstRate, weightGrams: l.weightGrams ?? null, receivedQty: 0, acceptedQty: 0, billedQty: 0 };
  });
  return { lines: out, subtotalMinor: subMinor, subtotalInrPaise: subInr, taxPaise: tax, totalInrPaise: subInr + tax, rate, intra };
}
export async function createPOCore(c: Caller, input: z.output<typeof CreatePOInput>, extra?: (tx: Transaction, poId: string) => void) {
  const vendor = must((await col('vendors').doc(input.vendorId).get()).data() as Doc | undefined, 'Vendor not found');
  if (vendor.status === 'inactive') fail('Vendor is inactive');
  if (input.type === 'domestic' && input.currency !== 'INR') fail('Domestic POs are in INR');
  if (input.type === 'import' && input.currency === 'INR') fail('Import POs need a foreign currency');
  const priced = await priceLines(vendor, input.type, input.currency, input.lines);
  const matrix = await loadMatrix();
  const route = routeApproval('PO', priced.totalInrPaise, matrix, { role: c.claims.role, approvalLimitPaise: c.claims.approvalLimitPaise });
  const ref = col('purchaseOrders').doc();
  const pr = input.prId ? await col('purchaseRequisitions').doc(input.prId).get() : null;
  return db.runTransaction(async (tx) => {
    const num = await reserveNumber(tx, 'PO', 'WH-CENTRAL'); num.write();
    const flow: FlowState = {};
    if (pr?.exists) flow.PR = { id: pr.id, number: pr.get('number') };
    flow.PO = { id: ref.id, number: num.number };
    const status = route.autoApprove ? 'approved' : 'pending_approval';
    tx.set(ref, {
      number: num.number, vendorId: input.vendorId, vendorName: vendor.name, isMsme: !!vendor.isMsme, type: input.type, currency: input.currency, fxRatePaisePerUnit: priced.rate, incoterm: input.incoterm ?? vendor.incoterm ?? null,
      paymentTermsDays: input.paymentTermsDays ?? vendor.paymentTermsDays ?? 30, expectedDate: input.expectedDate ?? null, locationId: 'WH-CENTRAL', intraState: priced.intra,
      lines: priced.lines, subtotalMinor: priced.subtotalMinor, subtotalInrPaise: priced.subtotalInrPaise, taxPaise: priced.taxPaise, totalInrPaise: priced.totalInrPaise,
      schedule: input.schedule ?? [], status, approverRole: route.approverRole, version: 1, flow, prId: input.prId ?? null, rfqId: input.rfqId ?? null, notes: input.notes ?? null,
      createdBy: c.uid, createdByName: c.name, createdAt: FieldValue.serverTimestamp(),
      ...(route.autoApprove ? { approvedBy: c.uid, approvedAt: FieldValue.serverTimestamp() } : {}),
    });
    if (pr?.exists) tx.update(pr.ref, { status: 'converted', poId: ref.id, poNumber: num.number });
    extra?.(tx, ref.id);
    audit(tx, c, { action: 'create_po', entity: 'purchaseOrders', entityId: ref.id, before: null, after: { number: num.number, totalInrPaise: priced.totalInrPaise, status } });
    return { id: ref.id, number: num.number, status, approverRole: route.approverRole, totalInrPaise: priced.totalInrPaise };
  });
}
export async function createPO(c: Caller, input: z.output<typeof CreatePOInput>) { requireRoles(c, 'buyer'); return createPOCore(c, input); }

export async function amendPO(c: Caller, input: z.output<typeof AmendPOInput>) {
  requireRoles(c, 'buyer');
  const ref = col('purchaseOrders').doc(input.poId);
  const po = must((await ref.get()).data() as Doc | undefined, 'PO not found');
  if (['received', 'closed', 'cancelled', 'rejected'].includes(po.status)) fail(`Cannot amend a ${po.status} PO`);
  const vendor = must((await col('vendors').doc(po.vendorId).get()).data() as Doc | undefined, 'Vendor not found');
  let patch: Doc = {};
  if (input.lines) {
    const received = new Map((po.lines as Doc[]).map((l) => [l.skuId, l.receivedQty as number]));
    for (const l of input.lines) if (l.qty < (received.get(l.skuId) ?? 0)) fail(`${l.skuId}: cannot reduce below received qty ${received.get(l.skuId)}`);
    const priced = await priceLines(vendor, po.type, po.currency, input.lines);
    const old = new Map((po.lines as Doc[]).map((l) => [l.skuId, l]));
    priced.lines.forEach((l) => { const o = old.get(l.skuId); if (o) { l.receivedQty = o.receivedQty; l.acceptedQty = o.acceptedQty; l.billedQty = o.billedQty; } });
    patch = { lines: priced.lines, subtotalMinor: priced.subtotalMinor, subtotalInrPaise: priced.subtotalInrPaise, taxPaise: priced.taxPaise, totalInrPaise: priced.totalInrPaise };
  }
  if (input.schedule) patch.schedule = input.schedule;
  if (input.expectedDate !== undefined && input.expectedDate !== null) patch.expectedDate = input.expectedDate;
  const newTotal = (patch.totalInrPaise as number | undefined) ?? po.totalInrPaise;
  const matrix = await loadMatrix();
  const route = routeApproval('PO', newTotal, matrix, { role: c.claims.role, approvalLimitPaise: c.claims.approvalLimitPaise });
  const needsReapproval = newTotal > po.totalInrPaise && !route.autoApprove;
  return db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (cur.get('version') !== po.version) fail('PO changed while amending; reload and retry');
    const { flow: _f, ...snapshot } = po; void _f;
    tx.set(ref.collection('versions').doc(String(po.version).padStart(4, '0')), { ...snapshot, snapshotAt: FieldValue.serverTimestamp(), supersededBy: c.uid, amendReason: input.reason });
    tx.update(ref, { ...patch, version: po.version + 1, amendReason: input.reason, ...(needsReapproval ? { status: 'pending_approval', approverRole: route.approverRole } : {}), updatedAt: FieldValue.serverTimestamp() });
    audit(tx, c, { action: 'amend_po', entity: 'purchaseOrders', entityId: input.poId, before: { version: po.version, total: po.totalInrPaise }, after: { version: po.version + 1, total: newTotal, reason: input.reason } });
    return { id: input.poId, version: po.version + 1, status: needsReapproval ? 'pending_approval' : po.status };
  });
}

/** Mock MessagingAdapter: writes to messageLog instead of calling an e-mail / WhatsApp provider. */
export async function sendPO(c: Caller, input: z.output<typeof SendPOInput>) {
  requireRoles(c, 'buyer');
  const ref = col('purchaseOrders').doc(input.poId);
  const po = must((await ref.get()).data() as Doc | undefined, 'PO not found');
  if (!['approved', 'sent', 'acknowledged'].includes(po.status)) fail('PO must be approved before sending');
  const vendor = (await col('vendors').doc(po.vendorId).get()).data() as Doc | undefined;
  const to = input.channel === 'email' ? vendor?.email : vendor?.phone ?? '+91-0000000000';
  const b = db.batch();
  b.set(col('messageLog').doc(), { channel: input.channel, to: to ?? 'n/a', subject: `PO ${po.number}`, body: `Dear ${po.vendorName}, please find PO ${po.number} (${po.lines.length} lines). [mock send]`, refType: 'purchaseOrder', refId: input.poId, mock: true, sentBy: c.uid, at: FieldValue.serverTimestamp() });
  b.update(ref, { status: po.status === 'approved' ? 'sent' : po.status, sentAt: FieldValue.serverTimestamp(), lastSentVia: input.channel });
  audit(b, c, { action: 'send_po', entity: 'purchaseOrders', entityId: input.poId, before: null, after: { channel: input.channel, to } });
  await b.commit();
  return { ok: true, to, mock: true };
}

// ───────────────────────── Vendor portal (also usable by buyers on a vendor's behalf)
async function vendorPo(c: Caller, poId: string): Promise<Doc> {
  const po = must((await col('purchaseOrders').doc(poId).get()).data() as Doc | undefined, 'PO not found');
  if (c.claims.role === 'vendor') { if (c.claims.vendorId !== po.vendorId) throw new HttpsError('permission-denied', 'Not your purchase order'); }
  else requireRoles(c, 'buyer');
  return po;
}
export async function ackPO(c: Caller, input: z.output<typeof AckPOInput>) {
  const po = await vendorPo(c, input.poId);
  if (!['approved', 'sent', 'acknowledged'].includes(po.status)) fail(`PO is ${po.status}; it can be acknowledged once approved`);
  const b = db.batch();
  b.set(col('poAcks').doc(input.poId), { poId: input.poId, poNumber: po.number, vendorId: po.vendorId, promisedDate: input.promisedDate ?? po.expectedDate ?? null, note: input.note ?? null, ackBy: c.uid, ackByName: c.name, at: FieldValue.serverTimestamp() });
  b.update(col('purchaseOrders').doc(input.poId), { status: po.status === 'partially_received' ? po.status : 'acknowledged', acknowledgedAt: FieldValue.serverTimestamp(), promisedDate: input.promisedDate ?? po.expectedDate ?? null });
  audit(b, c, { action: 'ack_po', entity: 'purchaseOrders', entityId: input.poId, before: null, after: { promisedDate: input.promisedDate ?? null } });
  await b.commit();
  return { ok: true };
}
export async function recordProforma(c: Caller, input: z.output<typeof RecordProformaInput>) {
  const po = await vendorPo(c, input.poId);
  if (!input.storagePath.includes(`/${po.vendorId}/`) && c.claims.role === 'vendor') fail('File must be uploaded under your vendor folder');
  const b = db.batch();
  b.update(col('purchaseOrders').doc(input.poId), { proforma: { path: input.storagePath, amountMinor: input.amountMinor ?? null, note: input.note ?? null, by: c.name, at: new Date().toISOString() } });
  audit(b, c, { action: 'upload_proforma', entity: 'purchaseOrders', entityId: input.poId, before: null, after: { path: input.storagePath } });
  await b.commit();
  return { ok: true };
}
export async function createASN(c: Caller, input: z.output<typeof CreateASNInput>) {
  const po = await vendorPo(c, input.poId);
  if (!['approved', 'sent', 'acknowledged', 'partially_received'].includes(po.status)) fail(`PO is ${po.status}`);
  const ordered = new Map((po.lines as Doc[]).map((l) => [l.skuId, l]));
  for (const l of input.lines) { const o = ordered.get(l.skuId); if (!o) fail(`${l.skuId} is not on the PO`); if (l.qty > o.qty - o.receivedQty) fail(`${l.skuId}: ASN qty ${l.qty} exceeds open qty ${o.qty - o.receivedQty}`); }
  const ref = col('asns').doc();
  return db.runTransaction(async (tx) => {
    const num = await reserveNumber(tx, 'ASN', 'WH-CENTRAL'); num.write();
    tx.set(ref, { number: num.number, poId: input.poId, poNumber: po.number, vendorId: po.vendorId, vendorName: po.vendorName, eta: input.eta, awb: input.awb ?? null, containerNo: input.containerNo ?? null, boxes: input.boxes ?? null, lines: input.lines.map((l) => ({ ...l, name: ordered.get(l.skuId)!.name })), status: 'in_transit', createdBy: c.uid, createdAt: FieldValue.serverTimestamp() });
    tx.update(col('purchaseOrders').doc(input.poId), { 'flow.ASN': { id: ref.id, number: num.number } });
    audit(tx, c, { action: 'create_asn', entity: 'asns', entityId: ref.id, before: null, after: { number: num.number, eta: input.eta } });
    return { id: ref.id, number: num.number };
  });
}
export async function saveBillOfEntry(c: Caller, input: z.output<typeof SaveBoEInput>) {
  requireRoles(c, 'buyer', 'warehouse_manager', 'cfo');
  const po = must((await col('purchaseOrders').doc(input.poId).get()).data() as Doc | undefined, 'PO not found');
  if (po.type !== 'import') fail('Bill of Entry applies to import POs only');
  const d = importDuty({ assessableValuePaise: input.assessableValuePaise, bcdPct: input.bcdPct, swsPctOfBcd: input.swsPct, igstPct: input.igstPct });
  const ref = col('billsOfEntry').doc();
  const b = db.batch();
  b.set(ref, {
    poId: input.poId, poNumber: po.number, asnId: input.asnId ?? null, beNumber: input.beNumber, beDate: input.beDate, port: input.port, chaId: input.chaId ?? null,
    assessableValuePaise: input.assessableValuePaise, bcdPct: input.bcdPct, swsPct: input.swsPct, igstPct: input.igstPct, ...d, chaChargesPaise: input.chaChargesPaise, otherChargesPaise: input.otherChargesPaise,
    totalLandedChargesPaise: d.landedAddPaise + input.chaChargesPaise + input.otherChargesPaise, igstCreditPaise: d.igstPaise, createdBy: c.uid, createdAt: FieldValue.serverTimestamp(),
  });
  audit(b, c, { action: 'save_boe', entity: 'billsOfEntry', entityId: ref.id, before: null, after: { beNumber: input.beNumber, ...d } });
  await b.commit();
  return { id: ref.id, ...d, totalLandedChargesPaise: d.landedAddPaise + input.chaChargesPaise + input.otherChargesPaise };
}

// ───────────────────────── Maker-checker for operational documents
export async function decideDocument(c: Caller, input: z.output<typeof DecideDocInput>) {
  const ref = col(input.collection).doc(input.id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = must(snap.exists ? (snap.data() as Doc) : null, 'Document not found');
    if (d.status !== 'pending_approval') fail(`Already ${d.status}`);
    const makerUid = (d.requestedBy ?? d.createdBy ?? d.madeBy) as string;
    const amount = (d.totalPaise ?? d.totalInrPaise ?? d.amountPaise ?? d.valuePaise ?? 0) as number;
    const err = mayApprove({ uid: c.uid, role: c.claims.role, approvalLimitPaise: c.claims.approvalLimitPaise }, makerUid, d.approverRole, amount);
    if (err) throw new HttpsError('permission-denied', err);
    if (!input.approve) {
      tx.update(ref, { status: 'rejected', decidedBy: c.uid, decidedByName: c.name, decisionNote: input.note ?? null, decidedAt: FieldValue.serverTimestamp() });
      audit(tx, c, { action: 'reject_doc', entity: input.collection, entityId: input.id, before: { status: d.status }, after: { note: input.note ?? null } });
      return { status: 'rejected' };
    }
    const decided = { decidedBy: c.uid, decidedByName: c.name, decisionNote: input.note ?? null, decidedAt: FieldValue.serverTimestamp() };
    if (input.collection === 'paymentVouchers') await applyPaymentEffects(tx, c, ref, d, decided);
    else if (input.collection === 'adjustments') await applyAdjustmentEffects(tx, c, ref, d, decided);
    else tx.update(ref, { status: 'approved', ...decided });
    audit(tx, c, { action: 'approve_doc', entity: input.collection, entityId: input.id, before: { status: d.status }, after: { status: input.collection === 'paymentVouchers' ? 'posted' : input.collection === 'adjustments' ? 'posted' : 'approved' } });
    return { status: input.collection === 'paymentVouchers' || input.collection === 'adjustments' ? 'posted' : 'approved' };
  });
}
void StockEngine; void ymd;
