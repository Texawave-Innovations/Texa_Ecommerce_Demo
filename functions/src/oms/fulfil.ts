import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { z } from 'zod';
import type { ConfirmPickInput, CourierEventInput, CreateShipmentInput, PackOrderInput } from '@texafashions/types';
import { DEFAULT_ALLOC_POLICY, allocateOrder, buildInvoice, buildSaleJournal, journalBalanced, verifyPack, type PricedLine } from '@texafashions/domain';
import { FieldValue, Timestamp, col, db, type Caller } from '../admin';
import { StockEngine, audit, fail, getMasterDocs, must, requireLocation, reserveNumber, ymd } from '../engine';
import { courier } from '../adapters/courier';
import { OMS_SYSTEM, loadLocations, patchUnit, requireOps, rollup, stockPairs, writePickLists, type Doc } from './orders';

const stamp = () => FieldValue.serverTimestamp();
const iso = () => new Date().toISOString();
const timeline = (text: string) => FieldValue.arrayUnion({ at: iso(), text });

export async function getLoc(id: string): Promise<Doc & { id: string; kind: 'warehouse' | 'store' }> {
  const [w, s] = await Promise.all([col('warehouses').doc(id).get(), col('stores').doc(id).get()]);
  return must(w.exists ? { ...(w.data() as Doc), id, kind: 'warehouse' as const } : s.exists ? { ...(s.data() as Doc), id, kind: 'store' as const } : null, `Unknown location ${id}`);
}

// ───────────────────────────────────────────────────────────── pick
export async function confirmPick(c: Caller, i: z.output<typeof ConfirmPickInput>) {
  requireOps(c);
  const plRef = col('pickLists').doc(i.pickListId);
  const pre = must((await plRef.get()).data() as Doc | undefined, 'Pick list not found');
  requireLocation(c, pre.locationId);
  const locs = pre.type === 'ship' ? await loadLocations() : [];
  const orderSkus = (pre.lines as Doc[]).map((l) => l.skuId);
  const skus = await getMasterDocs<Doc>('skus', orderSkus);
  return db.runTransaction(async (tx) => {
    const orderRef = col('webOrders').doc(pre.orderId);
    const [plSnap, oSnap] = await tx.getAll(plRef, orderRef);
    const pl = must(plSnap!.data() as Doc | undefined, 'Pick list not found'); const order = must(oSnap!.data() as Doc | undefined, 'Order not found');
    if (pl.status !== 'open') fail(`Pick list is ${pl.status}`);
    const picked = new Map(i.picks.map((p) => [p.skuId, p.pickedQty]));
    for (const l of pl.lines as Doc[]) {
      if (!picked.has(l.skuId)) fail(`Missing pick result for ${l.name}`);
      if (picked.get(l.skuId)! > l.qty) fail(`Picked ${picked.get(l.skuId)} of ${l.name} but only ${l.qty} requested`);
    }
    const short = (pl.lines as Doc[]).filter((l) => picked.get(l.skuId)! < l.qty);
    if (!short.length) {
      const lines = (pl.lines as Doc[]).map((l) => ({ ...l, pickedQty: l.qty }));
      tx.update(plRef, { lines, status: 'picked', pickedBy: c.uid, pickedByName: c.name, pickedAt: stamp() });
      const units = patchUnit(order.units, i.pickListId, { status: 'picked' });
      tx.update(orderRef, { units, status: rollup(order, units), updatedAt: stamp(), timeline: timeline(`Picked at ${pl.locationName}`) });
      audit(tx, c, { action: 'pick_confirmed', entity: 'pickLists', entityId: i.pickListId, before: { status: 'open' }, after: { status: 'picked' } });
      return { status: 'picked', short: [] as string[] };
    }

    // Short pick: the shelf/bin holds less than the system said. Release the missing reservations, flag the stock for a count, and try another location.
    const skuIds = [...new Set([...orderSkus, ...(order.lines as Doc[]).map((l: Doc) => l.skuId)])];
    const eng = await StockEngine.load(tx, locs.length ? stockPairs(locs, skuIds) : skuIds.map((s) => [pl.locationId, s] as [string, string]), { ignoreLock: true });
    const orderLines: Doc[] = (order.lines as Doc[]).map((l) => ({ ...l }));
    const newLines: Doc[] = []; let removedNet = 0; const shortNames: string[] = [];
    for (const l of pl.lines as Doc[]) {
      const got = picked.get(l.skuId)!; const miss = l.qty - got;
      if (miss > 0) {
        const missNet = got === 0 ? l.netPaise : Math.round((l.netPaise * miss) / l.qty);
        const ol = orderLines.find((x) => x.skuId === l.skuId)!; ol.unallocQty += miss; ol.unallocNet += missNet; removedNet += missNet; shortNames.push(`${miss}×${l.name}`);
        eng.move({ locationId: pl.locationId, skuId: l.skuId, bucket: 'reserved', qty: -Math.min(miss, eng.get(pl.locationId, l.skuId).reserved ?? 0), kind: 'move', refType: 'webOrder', refId: pre.orderId, reason: 'Short pick — reservation released' });
        eng.annotate(pl.locationId, l.skuId, 'short_pick', 'pickList', i.pickListId, `Picker found ${got} of ${l.qty} (system said available) — cycle count advised`);
        if (got > 0) newLines.push({ ...l, qty: got, pickedQty: got, netPaise: l.netPaise - missNet });
      } else newLines.push({ ...l, pickedQty: l.qty });
    }
    const emptied = newLines.length === 0;
    const payable = newLines.reduce((s, l) => s + l.netPaise, 0) + (emptied ? 0 : pl.shippingPaise);
    let shippingUnassigned = order.shippingUnassignedPaise ?? 0; if (emptied) shippingUnassigned += pl.shippingPaise;
    let units: Doc[] = patchUnit(order.units, i.pickListId, { status: emptied ? 'cancelled' : 'picked' });
    const patch: Doc = { lines: orderLines, shippingUnassignedPaise: shippingUnassigned };

    // Re-allocate the shortage elsewhere (ship orders only — a BOPIS customer is promised THIS store's stock).
    let realloc = 'needs_attention';
    if (pl.type === 'ship') {
      const need = orderLines.filter((l) => l.unallocQty > 0).map((l) => ({ skuId: l.skuId, qty: l.unallocQty }));
      const view = locs.filter((l) => l.id !== pl.locationId).map((l) => ({ id: l.id, kind: l.kind, state: l.state, city: l.city, stock: Object.fromEntries(skuIds.map((s) => { const d = eng.get(l.id, s); return [s, { onHand: d.onHand, reserved: d.reserved ?? 0 }]; })) }));
      const r = allocateOrder({ lines: need, fulfilmentType: 'ship', shipTo: { state: order.shipTo?.state, city: order.shipTo?.city } }, view, DEFAULT_ALLOC_POLICY);
      if (r.complete) {
        const w = writePickLists(tx, { orderId: pre.orderId, order: { ...order, ...patch, units }, allocations: r.allocations, eng, locs, skus });
        patch.lines = w.lines; patch.shippingUnassignedPaise = w.shippingUnassignedPaise; patch.pickListCount = w.pickListCount; units = [...units, ...w.units]; realloc = `moved to ${r.allocations.map((a) => a.locationId).join(', ')}`;
      }
    }
    eng.commit(tx, c);
    patch.units = units; patch.locationIds = [...new Set(units.filter((u) => u.status !== 'cancelled').map((u) => u.locationId))];
    patch.needsAttention = realloc === 'needs_attention' ? `Short pick at ${pl.locationId}: ${shortNames.join(', ')}` : null;
    patch.status = rollup({ ...order, awaitingStock: false }, units);
    tx.update(orderRef, { ...patch, updatedAt: stamp(), timeline: timeline(`Short pick at ${pl.locationName}: ${shortNames.join(', ')} — ${realloc === 'needs_attention' ? 'no other stock; needs attention' : realloc}`) });
    tx.update(plRef, { lines: newLines, status: emptied ? 'cancelled' : 'picked', payablePaise: payable, codAmountPaise: pl.codAmountPaise ? payable : 0, shippingPaise: emptied ? 0 : pl.shippingPaise, shortPick: shortNames, pickedBy: c.uid, pickedByName: c.name, pickedAt: stamp() });
    audit(tx, c, { action: 'pick_short', entity: 'pickLists', entityId: i.pickListId, before: { status: 'open' }, after: { short: shortNames, realloc, removedNet } });
    return { status: emptied ? 'cancelled' : 'picked', short: shortNames, realloc };
  });
}

// ───────────────────────────────────────────────────────────── pack verification scan
export async function packOrder(c: Caller, i: z.output<typeof PackOrderInput>) {
  requireOps(c);
  const plRef = col('pickLists').doc(i.pickListId);
  const pl0 = must((await plRef.get()).data() as Doc | undefined, 'Pick list not found');
  requireLocation(c, pl0.locationId);
  if (pl0.status !== 'picked') fail(`Pick list is ${pl0.status}; it must be picked before packing`);
  const skus = await getMasterDocs<Doc>('skus', (pl0.lines as Doc[]).map((l) => l.skuId));
  const barcodeToSku: Record<string, string> = {};
  for (const [id, s] of skus) { barcodeToSku[id] = id; if (s.barcode) barcodeToSku[String(s.barcode)] = id; }
  const names = new Map((pl0.lines as Doc[]).map((l) => [l.skuId, l.name as string]));
  const v = verifyPack((pl0.lines as Doc[]).map((l) => ({ skuId: l.skuId, qty: l.qty })), i.scans, barcodeToSku);
  if (!v.ok) {
    const msg = [
      v.missing.length ? `Missing ${v.missing.map((m) => `${m.qty}× ${names.get(m.skuId) ?? m.skuId}`).join(', ')}` : '',
      v.extra.length ? `Unexpected ${v.extra.map((m) => `${m.qty}× ${names.get(m.skuId) ?? m.skuId}`).join(', ')}` : '',
      v.unknownBarcodes.length ? `Unknown barcode ${v.unknownBarcodes.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    await plRef.update({ packAttempts: FieldValue.increment(1), lastPackError: msg, lastPackErrorAt: stamp() });
    throw new HttpsError('failed-precondition', `Pack check failed — ${msg}`);
  }
  const orderRef = col('webOrders').doc(pl0.orderId);
  return db.runTransaction(async (tx) => {
    const [plSnap, oSnap] = await tx.getAll(plRef, orderRef);
    const pl = plSnap!.data() as Doc; const order = must(oSnap!.data() as Doc | undefined, 'Order not found');
    if (pl.status !== 'picked') fail(`Pick list is ${pl.status}`);
    const weightG = i.weightG ?? Math.max(100, (pl.lines as Doc[]).reduce((s, l) => s + l.qty, 0) * 180);
    tx.update(plRef, { status: 'packed', giftNote: i.giftNote ?? pl.giftNote ?? null, weightG, scanned: v.scanned, packedBy: c.uid, packedByName: c.name, packedAt: stamp() });
    const units = patchUnit(order.units, i.pickListId, { status: 'packed' });
    tx.update(orderRef, { units, status: rollup(order, units), updatedAt: stamp(), timeline: timeline(`Packed & verified at ${pl.locationName} (${i.scans.length} scans)`) });
    audit(tx, c, { action: 'pack_verified', entity: 'pickLists', entityId: i.pickListId, before: { status: 'picked' }, after: { status: 'packed', scans: i.scans.length, weightG } });
    return { status: 'packed', weightG, scanned: v.scanned };
  });
}

// ───────────────────────────────────────────────────────────── invoice + stock issue + journal (shared by shipment and BOPIS handover)
/** Must be called inside a transaction BEFORE any write (it performs the counter + stock reads, then writes). */
export async function invoiceAndIssue(tx: Transaction, c: Caller, p: { pl: Doc; plId: string; intraState: boolean; tender: string; refType: 'shipment' | 'bopis'; refId: string; sellerGstin?: string | null }) {
  const { pl } = p;
  const num = await reserveNumber(tx, 'WINV', pl.locationId);
  const eng = await StockEngine.load(tx, (pl.lines as Doc[]).map((l) => [pl.locationId, l.skuId] as [string, string]), { ignoreLock: true });
  const priced = [
    ...(pl.lines as Doc[]).map((l, k) => ({ lineId: `L${k + 1}`, skuId: l.skuId, name: l.name, qty: l.qty, gstRate: l.gstRate, hsn: l.hsn ?? undefined, grossPaise: l.netPaise, discountPaise: 0, netPaise: l.netPaise, allocations: [] })),
    ...(pl.shippingPaise > 0 ? [{ lineId: 'SHIP', skuId: 'SVC-SHIPPING', name: 'Shipping & handling', qty: 1, gstRate: 18, hsn: '9965', grossPaise: pl.shippingPaise, discountPaise: 0, netPaise: pl.shippingPaise, allocations: [] }] : []),
  ] as unknown as PricedLine[];
  const inv = buildInvoice(priced, p.intraState);
  let cogs = 0; const costs: Doc[] = [];
  for (const l of pl.lines as Doc[]) {
    const reserved = eng.get(pl.locationId, l.skuId).reserved ?? 0;
    eng.move({ locationId: pl.locationId, skuId: l.skuId, bucket: 'reserved', qty: -Math.min(l.qty, reserved), kind: 'move', refType: p.refType, refId: p.refId, reason: `Released on ${p.refType === 'bopis' ? 'handover' : 'dispatch'}` });
    const cost = eng.move({ locationId: pl.locationId, skuId: l.skuId, bucket: 'onHand', qty: -l.qty, kind: 'issue', refType: p.refType === 'bopis' ? 'webOrderBopis' : 'webOrderShipment', refId: p.refId, reason: `Web order ${pl.orderName}` });
    cogs += cost * l.qty; costs.push({ skuId: l.skuId, name: l.name, qty: l.qty, unitCostPaise: cost });
  }
  const journal = buildSaleJournal(inv, [{ mode: p.tender, amountPaise: pl.payablePaise }], cogs).map((l) => (l.ledgerId === 'L-SALES' ? { ...l, ledgerId: 'L-SALES-WEB', narration: 'Web sales (net of discount)' } : l));
  if (!journalBalanced(journal)) fail('Internal error: web sale journal does not balance');
  const jRef = col('journals').doc();
  tx.set(jRef, { event: 'web_sale', refType: p.refType, refId: p.refId, storeId: pl.locationId, orderId: pl.orderId, day: ymd(), lines: journal, balanced: true, at: stamp() });
  num.write(); eng.commit(tx, c);
  const invoice = { number: num.number, sellerGstin: p.sellerGstin ?? null, interState: !p.intraState, taxablePaise: inv.taxablePaise, totalTaxPaise: inv.totalTaxPaise, igstPaise: inv.igstPaise, cgstPaise: inv.cgstPaise, sgstPaise: inv.sgstPaise, roundOffPaise: inv.roundOffPaise, payablePaise: inv.payablePaise, taxSummary: inv.taxSummary, lines: inv.lines };
  return { invoice, journalId: jRef.id, costs, cogs };
}

// ───────────────────────────────────────────────────────────── shipment (mock Shiprocket)
export async function createShipment(c: Caller, i: z.output<typeof CreateShipmentInput>) {
  requireOps(c);
  const plRef = col('pickLists').doc(i.pickListId);
  const pl0 = must((await plRef.get()).data() as Doc | undefined, 'Pick list not found');
  requireLocation(c, pl0.locationId);
  if (pl0.shipmentId) return { shipmentId: pl0.shipmentId, awb: pl0.awb, already: true };
  if (pl0.type !== 'ship') fail('BOPIS orders are handed over at the store, not shipped');
  if (pl0.status !== 'packed') fail(`Pick list is ${pl0.status}; pack and verify it first`);
  const loc = await getLoc(pl0.locationId);
  const gstin = loc.gstinId ? ((await col('gstins').doc(loc.gstinId).get()).data() as Doc | undefined)?.gstin ?? null : null;
  // Idempotent by pick list id: a retry after a failed transaction re-uses the same AWB.
  const booking = await courier.book({ reference: i.pickListId, fromState: loc.state, toPincode: pl0.shipTo.pincode, toState: pl0.shipTo.state, weightG: pl0.weightG ?? 500, cod: pl0.codAmountPaise > 0, codAmountPaise: pl0.codAmountPaise, declaredValuePaise: pl0.payablePaise });
  const shipRef = col('shipments').doc(i.pickListId); const orderRef = col('webOrders').doc(pl0.orderId);
  return db.runTransaction(async (tx) => {
    const [plSnap, oSnap] = await tx.getAll(plRef, orderRef);
    const pl = plSnap!.data() as Doc; const order = must(oSnap!.data() as Doc | undefined, 'Order not found');
    if (pl.shipmentId) return { shipmentId: pl.shipmentId, awb: pl.awb, already: true };
    if (pl.status !== 'packed') fail(`Pick list is ${pl.status}`);
    const intra = !!loc.state && !!pl.shipTo?.state && String(loc.state).toLowerCase() === String(pl.shipTo.state).toLowerCase();
    const r = await invoiceAndIssue(tx, c, { pl, plId: i.pickListId, intraState: intra, tender: pl.paymentMode === 'cod' ? 'COD' : 'WEB', refType: 'shipment', refId: shipRef.id, sellerGstin: gstin });
    const eta = new Date(Date.now() + booking.etaDays * 86_400_000);
    tx.set(shipRef, {
      awb: booking.awb, courier: booking.courier, courierProvider: courier.name, mock: booking.mock, labelUrl: booking.labelUrl, freightPaise: booking.freightPaise, codFeePaise: booking.codFeePaise, etaDate: eta.toISOString().slice(0, 10),
      orderId: pl.orderId, orderName: pl.orderName, orderNumber: pl.orderNumber, pickListId: i.pickListId, locationId: pl.locationId, locationName: pl.locationName, status: 'booked',
      paymentMode: pl.paymentMode, codAmountPaise: pl.codAmountPaise, codStatus: pl.codAmountPaise > 0 ? 'awaiting_delivery' : null, weightG: pl.weightG ?? 500, shipTo: pl.shipTo, giftNote: pl.giftNote ?? null,
      lines: r.costs, invoice: r.invoice, invoiceNo: r.invoice.number, journalId: r.journalId, cogsPaise: r.cogs, ndrCount: 0,
      events: [{ at: iso(), status: 'booked', note: `AWB ${booking.awb} via ${booking.courier}` }], createdAt: stamp(), createdBy: c.uid,
    });
    tx.update(plRef, { status: 'shipped', shipmentId: shipRef.id, awb: booking.awb, invoiceNo: r.invoice.number, shippedAt: stamp() });
    const units = patchUnit(order.units, i.pickListId, { status: 'shipped', shipmentId: shipRef.id, shipmentStatus: 'booked', awb: booking.awb, courier: booking.courier });
    tx.update(orderRef, { units, status: rollup(order, units), shipmentIds: FieldValue.arrayUnion(shipRef.id), updatedAt: stamp(), timeline: timeline(`Shipped from ${pl.locationName}: ${booking.courier} AWB ${booking.awb} · invoice ${r.invoice.number}`) });
    audit(tx, c, { action: 'shipment_created', entity: 'shipments', entityId: shipRef.id, before: null, after: { awb: booking.awb, invoice: r.invoice.number, payablePaise: pl.payablePaise, cod: pl.codAmountPaise > 0 } });
    return { shipmentId: shipRef.id, awb: booking.awb, courier: booking.courier, invoiceNo: r.invoice.number, labelUrl: booking.labelUrl, etaDate: eta.toISOString().slice(0, 10), already: false };
  });
}

// ───────────────────────────────────────────────────────────── courier tracking events (webhook / demo button)
const EVENT_FROM: Record<string, string[]> = {
  picked_up: ['booked'], in_transit: ['picked_up'], out_for_delivery: ['in_transit', 'ndr'], delivered: ['out_for_delivery', 'in_transit'],
  ndr: ['out_for_delivery'], rto_initiated: ['ndr', 'in_transit', 'out_for_delivery'], rto_delivered: ['rto_initiated'],
};
export async function applyCourierEvent(c: Caller, i: { awb: string; event: string; note?: string | null }) {
  const q = await col('shipments').where('awb', '==', i.awb).limit(1).get();
  const shipRef = must(q.docs[0]?.ref, `No shipment with AWB ${i.awb}`);
  return db.runTransaction(async (tx) => {
    const sSnap = await tx.get(shipRef); const s = sSnap.data() as Doc;
    const orderRef = col('webOrders').doc(s.orderId); const rtoRef = col('rtoCases').doc(shipRef.id);
    const oSnap = await tx.get(orderRef); const order = must(oSnap.data() as Doc | undefined, 'Order not found');
    if (s.status === i.event) return { status: s.status, duplicate: true };
    const allowed = EVENT_FROM[i.event]; if (!allowed) fail(`Unknown courier event ${i.event}`);
    if (!allowed.includes(s.status)) fail(`Cannot apply "${i.event}" to a parcel that is ${s.status}`);
    const patch: Doc = { status: i.event, events: FieldValue.arrayUnion({ at: iso(), status: i.event, note: i.note ?? null }), updatedAt: stamp() };
    const text = `Parcel ${s.awb}: ${i.event.replace(/_/g, ' ')}`;
    if (i.event === 'delivered') { patch.deliveredAt = stamp(); if (s.codAmountPaise > 0) patch.codStatus = 'with_courier'; }
    if (i.event === 'ndr') patch.ndrCount = FieldValue.increment(1);
    if (i.event === 'rto_initiated') {
      patch.rtoInitiatedAt = stamp();
      tx.set(rtoRef, { shipmentId: shipRef.id, awb: s.awb, courier: s.courier, orderId: s.orderId, orderName: s.orderName, locationId: s.locationId, locationName: s.locationName, status: 'in_transit_back', paymentMode: s.paymentMode, codAmountPaise: s.codAmountPaise, valuePaise: s.invoice?.payablePaise ?? 0, lines: s.lines, reason: i.note ?? 'Undelivered', createdAt: stamp() });
      if (s.codAmountPaise > 0) patch.codStatus = 'rto';
    }
    if (i.event === 'rto_delivered') tx.update(rtoRef, { status: 'at_origin', arrivedAt: stamp() });
    tx.update(shipRef, patch);
    const unit = (order.units as Doc[]).find((u) => u.shipmentId === shipRef.id);
    const units = patchUnit(order.units, unit?.pickListId ?? '', { shipmentStatus: i.event });
    tx.update(orderRef, { units, status: rollup(order, units), updatedAt: stamp(), timeline: timeline(text) });
    audit(tx, c, { action: `courier_${i.event}`, entity: 'shipments', entityId: shipRef.id, before: { status: s.status }, after: { status: i.event } });
    return { status: i.event, duplicate: false, shipmentId: shipRef.id };
  });
}
export async function courierEvent(c: Caller, i: z.output<typeof CourierEventInput>) { requireOps(c); return applyCourierEvent(c, i); }
export { OMS_SYSTEM, Timestamp };
