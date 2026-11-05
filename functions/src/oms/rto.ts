import type { z } from 'zod';
import type { QcRtoInput, ReceiveRtoInput } from '@texafashions/types';
import { reverseJournal, validateRtoQc, verifyPack, type JournalLine } from '@texafashions/domain';
import { FieldValue, col, db, type Caller } from '../admin';
import { StockEngine, audit, fail, getMasterDocs, must, requireLocation, reserveNumber, ymd } from '../engine';
import { patchUnit, requireOps, rollup, type Doc } from './orders';

const stamp = () => FieldValue.serverTimestamp();
const timeline = (text: string) => FieldValue.arrayUnion({ at: new Date().toISOString(), text });

/**
 * RTO parcel scanned back in at the origin: units go to the **inQC** bucket (never straight to sellable), the invoice is reversed
 * with a credit note + reversing journal, and prepaid orders are flagged for refund.
 */
export async function receiveRto(c: Caller, i: z.output<typeof ReceiveRtoInput>) {
  requireOps(c);
  const shipRef = col('shipments').doc(i.shipmentId);
  const s0 = must((await shipRef.get()).data() as Doc | undefined, 'Shipment not found');
  requireLocation(c, s0.locationId);
  if (s0.status !== 'rto_delivered') fail(`Parcel is ${s0.status}; it can be received once the courier marks RTO delivered`);
  const skus = await getMasterDocs<Doc>('skus', (s0.lines as Doc[]).map((l) => l.skuId));
  const b2s: Record<string, string> = {}; for (const [id, s] of skus) { b2s[id] = id; if (s.barcode) b2s[String(s.barcode)] = id; }
  let received: { skuId: string; qty: number }[] = (s0.lines as Doc[]).map((l) => ({ skuId: l.skuId, qty: l.qty }));
  let variance: string | null = null;
  if (i.scans?.length) {
    const v = verifyPack(received, i.scans, b2s);
    received = Object.entries(v.scanned).map(([skuId, qty]) => ({ skuId, qty: Math.min(qty, received.find((r) => r.skuId === skuId)?.qty ?? 0) })).filter((r) => r.qty > 0);
    if (!v.ok) variance = [v.missing.length ? `missing ${v.missing.map((m) => `${m.qty}×${m.skuId}`).join(', ')}` : '', v.extra.length ? `unexpected ${v.extra.map((m) => `${m.qty}×${m.skuId}`).join(', ')}` : '', v.unknownBarcodes.length ? `unknown barcode ${v.unknownBarcodes.join(', ')}` : ''].filter(Boolean).join('; ');
  }
  const rtoRef = col('rtoCases').doc(i.shipmentId); const orderRef = col('webOrders').doc(s0.orderId); const jOrig = col('journals').doc(s0.journalId);
  return db.runTransaction(async (tx) => {
    const [sSnap, rSnap, oSnap, jSnap] = await tx.getAll(shipRef, rtoRef, orderRef, jOrig);
    const s = sSnap!.data() as Doc; const order = must(oSnap!.data() as Doc | undefined, 'Order not found'); const jr = must(jSnap!.data() as Doc | undefined, 'Original sale journal missing');
    if (s.status !== 'rto_delivered') fail(`Parcel is ${s.status}`);
    if (!rSnap!.exists) fail('No RTO case for this parcel');
    const num = await reserveNumber(tx, 'WCN', s.locationId);
    const eng = await StockEngine.load(tx, received.map((r) => [s.locationId, r.skuId] as [string, string]), { ignoreLock: true });
    const cost = new Map((s.lines as Doc[]).map((l) => [l.skuId, l.unitCostPaise as number]));
    for (const r of received) eng.move({ locationId: s.locationId, skuId: r.skuId, bucket: 'inQC', qty: r.qty, kind: 'receipt', refType: 'rto', refId: i.shipmentId, unitCostPaise: cost.get(r.skuId) ?? 0, reason: `RTO ${s.awb}` });
    const rev = reverseJournal((jr.lines as JournalLine[]).map((l) => (l.ledgerId === 'L-SALES-WEB' ? { ...l, ledgerId: 'L-SALES' } : l)));
    const jRef = col('journals').doc();
    tx.set(jRef, { event: 'web_rto_reversal', refType: 'shipment', refId: i.shipmentId, storeId: s.locationId, orderId: s.orderId, day: ymd(), lines: rev, balanced: true, creditNoteNo: num.number, at: stamp() });
    num.write(); eng.commit(tx, c);
    const prepaidRefund = s.paymentMode === 'prepaid' && order.financialStatus === 'paid' ? (s.invoice?.payablePaise ?? 0) : 0;
    tx.update(rtoRef, { status: 'pending_qc', received, variance, creditNoteNo: num.number, reversalJournalId: jRef.id, refundDuePaise: prepaidRefund, receivedBy: c.uid, receivedAt: stamp() });
    tx.update(shipRef, { status: 'rto_received', events: FieldValue.arrayUnion({ at: new Date().toISOString(), status: 'rto_received', note: `Received at ${s.locationName}${variance ? ` — variance: ${variance}` : ''}` }), updatedAt: stamp() });
    const unit = (order.units as Doc[]).find((u) => u.shipmentId === i.shipmentId);
    const units = patchUnit(order.units, unit?.pickListId ?? '', { shipmentStatus: 'rto_received' });
    tx.update(orderRef, { units, status: rollup(order, units), refundDue: prepaidRefund > 0 || order.refundDue, updatedAt: stamp(), timeline: timeline(`RTO received at ${s.locationName} → QC · credit note ${num.number}${prepaidRefund ? ' · prepaid refund due' : ''}`) });
    audit(tx, c, { action: 'rto_received', entity: 'rtoCases', entityId: i.shipmentId, before: { status: 'at_origin' }, after: { creditNote: num.number, units: received.reduce((a, r) => a + r.qty, 0), variance } });
    return { status: 'pending_qc', creditNoteNo: num.number, refundDuePaise: prepaidRefund, variance, received };
  });
}

/** QC outcome: good → back to sellable (inQC → onHand); damaged → damaged bucket + shrinkage journal at cost. */
export async function qcRto(c: Caller, i: z.output<typeof QcRtoInput>) {
  requireOps(c);
  const rtoRef = col('rtoCases').doc(i.rtoId);
  const pre = must((await rtoRef.get()).data() as Doc | undefined, 'RTO case not found');
  requireLocation(c, pre.locationId);
  if (pre.status !== 'pending_qc') fail(`RTO case is ${pre.status}`);
  const bad = validateRtoQc(pre.received, i.lines); if (bad) fail(bad);
  return db.runTransaction(async (tx) => {
    const rSnap = await tx.get(rtoRef); const r = rSnap.data() as Doc;
    if (r.status !== 'pending_qc') fail(`RTO case is ${r.status}`);
    const eng = await StockEngine.load(tx, i.lines.map((l) => [r.locationId, l.skuId] as [string, string]), { ignoreLock: true });
    const cost = new Map((r.lines as Doc[]).map((l) => [l.skuId, l.unitCostPaise as number])); let writeOff = 0; let good = 0; let damaged = 0;
    for (const l of i.lines) {
      if (l.good) { eng.move({ locationId: r.locationId, skuId: l.skuId, bucket: 'inQC', qty: -l.good, kind: 'move', refType: 'rtoQc', refId: i.rtoId, reason: 'RTO QC passed' }); eng.move({ locationId: r.locationId, skuId: l.skuId, bucket: 'onHand', qty: l.good, kind: 'move', refType: 'rtoQc', refId: i.rtoId, reason: 'RTO QC passed → sellable' }); good += l.good; }
      if (l.damaged) { eng.move({ locationId: r.locationId, skuId: l.skuId, bucket: 'inQC', qty: -l.damaged, kind: 'move', refType: 'rtoQc', refId: i.rtoId, reason: 'RTO QC failed' }); eng.move({ locationId: r.locationId, skuId: l.skuId, bucket: 'damaged', qty: l.damaged, kind: 'move', refType: 'rtoQc', refId: i.rtoId, reason: 'RTO damaged' }); writeOff += l.damaged * (cost.get(l.skuId) ?? 0); damaged += l.damaged; }
    }
    eng.commit(tx, c);
    if (writeOff > 0) tx.set(col('journals').doc(), { event: 'rto_writeoff', refType: 'rtoCase', refId: i.rtoId, storeId: r.locationId, orderId: r.orderId, day: ymd(), lines: [{ ledgerId: 'L-SHRINK', drPaise: writeOff, crPaise: 0, narration: 'RTO damaged stock' }, { ledgerId: 'L-INV', drPaise: 0, crPaise: writeOff }], balanced: true, at: stamp() });
    tx.update(rtoRef, { status: 'closed', qc: i.lines, qcNote: i.note ?? null, goodUnits: good, damagedUnits: damaged, writeOffPaise: writeOff, qcBy: c.uid, qcAt: stamp() });
    audit(tx, c, { action: 'rto_qc', entity: 'rtoCases', entityId: i.rtoId, before: { status: 'pending_qc' }, after: { good, damaged, writeOffPaise: writeOff } });
    return { status: 'closed', good, damaged, writeOffPaise: writeOff };
  });
}
