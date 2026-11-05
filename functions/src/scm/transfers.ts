import type { z } from 'zod';
import { CreateTransferInput, DispatchTransferInput, ReceiveTransferInput } from '@texafashions/types';
import { ewayRequired, mockEwayNumber, splitGst } from '@texafashions/domain';
import { FieldValue, col, db, type Caller } from '../admin';
import { StockEngine, audit, fail, getMasterDocs, must, requireLocation, requireRoles, reserveNumber } from '../engine';

type Doc = Record<string, any>;
const XFER_ROLES = ['warehouse_manager', 'store_manager', 'buyer'] as const;

async function location(id: string): Promise<Doc & { kind: 'warehouse' | 'store' }> {
  const [w, s] = await Promise.all([col('warehouses').doc(id).get(), col('stores').doc(id).get()]);
  const d = w.exists ? { ...(w.data() as Doc), kind: 'warehouse' as const } : s.exists ? { ...(s.data() as Doc), kind: 'store' as const } : null;
  return must(d, `Unknown location ${id}`);
}

export async function createTransfer(c: Caller, input: z.output<typeof CreateTransferInput>) {
  requireRoles(c, ...XFER_ROLES);
  if (input.fromLocationId === input.toLocationId) fail('Source and destination must differ');
  requireLocation(c, input.fromLocationId);
  const [from, to] = await Promise.all([location(input.fromLocationId), location(input.toLocationId)]);
  const skus = await getMasterDocs<Doc>('skus', input.lines.map((l) => l.skuId));
  const lines = input.lines.map((l) => { const s = must(skus.get(l.skuId), `Unknown SKU ${l.skuId}`); return { skuId: l.skuId, name: s.name, qty: l.qty, gstRate: Number(s.gstRate ?? 0), hsn: s.hsn ?? null }; });
  const ref = col('stockTransfers').doc();
  return db.runTransaction(async (tx) => {
    const num = await reserveNumber(tx, 'TRF', input.fromLocationId); num.write();
    tx.set(ref, { number: num.number, fromLocationId: input.fromLocationId, toLocationId: input.toLocationId, fromState: from.state ?? null, toState: to.state ?? null, fromName: from.name, toName: to.name, lines, status: 'draft', notes: input.notes ?? null, createdBy: c.uid, createdByName: c.name, createdAt: FieldValue.serverTimestamp() });
    audit(tx, c, { action: 'create_transfer', entity: 'stockTransfers', entityId: ref.id, before: null, after: { number: num.number, from: input.fromLocationId, to: input.toLocationId } });
    return { id: ref.id, number: num.number };
  });
}

export async function dispatchTransfer(c: Caller, input: z.output<typeof DispatchTransferInput>) {
  requireRoles(c, ...XFER_ROLES);
  const ref = col('stockTransfers').doc(input.transferId);
  const pre = must((await ref.get()).data() as Doc | undefined, 'Transfer not found');
  requireLocation(c, pre.fromLocationId);
  const [fromG, toG] = await Promise.all([location(pre.fromLocationId), location(pre.toLocationId)]);
  const gstins = await getMasterDocs<Doc>('gstins', [fromG.gstinId, toG.gstinId].filter(Boolean));
  return db.runTransaction(async (tx) => {
    const t = must((await tx.get(ref)).data() as Doc | undefined, 'Transfer not found');
    if (t.status !== 'draft') fail(`Transfer is ${t.status}`);
    const eng = await StockEngine.load(tx, (t.lines as Doc[]).flatMap((l) => [[t.fromLocationId, l.skuId], [t.toLocationId, l.skuId]] as [string, string][]));
    let value = 0;
    const lines: Doc[] = (t.lines as Doc[]).map((l) => {
      const cost = eng.move({ locationId: t.fromLocationId, skuId: l.skuId, bucket: 'onHand', qty: -l.qty, kind: 'issue', refType: 'transfer', refId: input.transferId, reason: `To ${t.toLocationId}` });
      eng.move({ locationId: t.toLocationId, skuId: l.skuId, bucket: 'inTransit', qty: l.qty, kind: 'move', refType: 'transfer', refId: input.transferId, unitCostPaise: cost, reason: `From ${t.fromLocationId}` });
      value += cost * l.qty;
      return { ...l, unitCostPaise: cost, valuePaise: cost * l.qty };
    });
    const interState = !!t.fromState && !!t.toState && t.fromState !== t.toState;
    const eway = ewayRequired(value);
    if (eway && !input.vehicleNo) fail('Consignment above ₹50,000 needs a vehicle number for the e-way bill');
    // Inter-state stock transfer between own GSTINs is a taxable supply → tax invoice with IGST. Intra-state → delivery challan.
    let taxInvoice: Doc | null = null; let invNum: Awaited<ReturnType<typeof reserveNumber>> | null = null;
    if (interState) {
      invNum = await reserveNumber(tx, 'TINV', t.fromLocationId);
      const igst = lines.reduce((a, l) => a + splitGst(l.valuePaise, l.gstRate, false).igstPaise, 0);
      taxInvoice = { number: invNum.number, taxableValuePaise: value, igstPaise: igst, totalPaise: value + igst, fromGstin: gstins.get(fromG.gstinId)?.gstin ?? null, toGstin: gstins.get(toG.gstinId)?.gstin ?? null };
    }
    const ewayRef = eway ? col('ewayBills').doc() : null;
    eng.commit(tx, c); invNum?.write();
    if (ewayRef) tx.set(ewayRef, { transferId: input.transferId, transferNumber: t.number, ewayBillNo: mockEwayNumber(input.transferId), valuePaise: value, vehicleNo: input.vehicleNo, from: t.fromLocationId, to: t.toLocationId, validUntil: new Date(Date.now() + 3 * 86_400_000).toISOString(), mock: true, status: 'active', createdAt: FieldValue.serverTimestamp() });
    tx.update(ref, { lines, status: 'in_transit', valuePaise: value, interState, docType: interState ? 'tax_invoice' : 'delivery_challan', taxInvoice, ewayBillId: ewayRef?.id ?? null, ewayBillNo: ewayRef ? mockEwayNumber(input.transferId) : null, vehicleNo: input.vehicleNo ?? null, dispatchedBy: c.uid, dispatchedAt: FieldValue.serverTimestamp() });
    audit(tx, c, { action: 'dispatch_transfer', entity: 'stockTransfers', entityId: input.transferId, before: { status: 'draft' }, after: { valuePaise: value, eway, interState } });
    return { status: 'in_transit', valuePaise: value, ewayBillNo: ewayRef ? mockEwayNumber(input.transferId) : null, taxInvoiceNumber: taxInvoice?.number ?? null, interState };
  });
}

export async function receiveTransfer(c: Caller, input: z.output<typeof ReceiveTransferInput>) {
  requireRoles(c, ...XFER_ROLES);
  const ref = col('stockTransfers').doc(input.transferId);
  const pre = must((await ref.get()).data() as Doc | undefined, 'Transfer not found');
  requireLocation(c, pre.toLocationId);
  return db.runTransaction(async (tx) => {
    const t = must((await tx.get(ref)).data() as Doc | undefined, 'Transfer not found');
    if (t.status !== 'in_transit') fail(`Transfer is ${t.status}`);
    const eng = await StockEngine.load(tx, (t.lines as Doc[]).map((l) => [t.toLocationId, l.skuId] as [string, string]));
    const got = new Map(input.lines.map((l) => [l.skuId, l]));
    let variance = false;
    const lines = (t.lines as Doc[]).map((l) => {
      const r = got.get(l.skuId) ?? { skuId: l.skuId, receivedQty: 0, damagedQty: 0 };
      if (r.receivedQty > l.qty) fail(`${l.skuId}: received ${r.receivedQty} is more than dispatched ${l.qty}`);
      if (r.damagedQty > r.receivedQty) fail(`${l.skuId}: damaged exceeds received`);
      const short = l.qty - r.receivedQty, good = r.receivedQty - r.damagedQty;
      if (good > 0) { eng.move({ locationId: t.toLocationId, skuId: l.skuId, bucket: 'inTransit', qty: -good, kind: 'move', refType: 'transfer', refId: input.transferId, reason: 'Transfer received' }); eng.move({ locationId: t.toLocationId, skuId: l.skuId, bucket: 'onHand', qty: good, kind: 'receipt', unitCostPaise: l.unitCostPaise, refType: 'transfer', refId: input.transferId, reason: 'Transfer received' }); }
      if (r.damagedQty > 0) { eng.move({ locationId: t.toLocationId, skuId: l.skuId, bucket: 'inTransit', qty: -r.damagedQty, kind: 'move', refType: 'transfer', refId: input.transferId, reason: 'Damaged in transit' }); eng.move({ locationId: t.toLocationId, skuId: l.skuId, bucket: 'damaged', qty: r.damagedQty, kind: 'move', refType: 'transfer', refId: input.transferId, reason: 'Damaged in transit' }); }
      if (short > 0) eng.move({ locationId: t.toLocationId, skuId: l.skuId, bucket: 'inTransit', qty: -short, kind: 'adjust', refType: 'transfer_variance', refId: input.transferId, reason: 'Short received — written off in transit' });
      if (short || r.damagedQty) variance = true;
      return { ...l, receivedQty: r.receivedQty, damagedQty: r.damagedQty, shortQty: short };
    });
    eng.commit(tx, c);
    tx.update(ref, { lines, status: variance ? 'received_with_variance' : 'received', receivedBy: c.uid, receivedAt: FieldValue.serverTimestamp() });
    if (t.ewayBillId) tx.update(col('ewayBills').doc(t.ewayBillId), { status: 'delivered' });
    audit(tx, c, { action: 'receive_transfer', entity: 'stockTransfers', entityId: input.transferId, before: { status: 'in_transit' }, after: { variance } });
    return { status: variance ? 'received_with_variance' : 'received', variance };
  });
}
