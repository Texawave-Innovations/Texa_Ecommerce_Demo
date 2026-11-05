import { HttpsError } from 'firebase-functions/v2/https';
import type { z } from 'zod';
import type { CollectBopisInput, ExpireBopisInput, MarkReadyForPickupInput } from '@texafashions/types';
import { BOPIS_HOLD_HOURS, bopisHoldUntil, pickupCode } from '@texafashions/domain';
import { FieldValue, Timestamp, col, db, type Caller } from '../admin';
import { StockEngine, audit, fail, must, requireLocation } from '../engine';
import { messaging } from '../adapters/messaging';
import { safeEqual } from '../shopify/hmac';
import { getLoc, invoiceAndIssue } from './fulfil';
import { OMS_SYSTEM, patchUnit, requireOps, rollup, type Doc } from './orders';

const stamp = () => FieldValue.serverTimestamp();
const timeline = (text: string) => FieldValue.arrayUnion({ at: new Date().toISOString(), text });

/** Packed BOPIS order → ready for pickup: 6-digit code, 48h hold, customer notified (mock WhatsApp). Stock stays reserved until handover. */
export async function markReadyForPickup(c: Caller, i: z.output<typeof MarkReadyForPickupInput>) {
  requireOps(c);
  const plRef = col('pickLists').doc(i.pickListId);
  const pre = must((await plRef.get()).data() as Doc | undefined, 'Pick list not found');
  requireLocation(c, pre.locationId);
  const orderRef = col('webOrders').doc(pre.orderId);
  const code = pickupCode(); const readyAt = new Date(); const holdUntil = bopisHoldUntil(readyAt);
  const out = await db.runTransaction(async (tx) => {
    const [plSnap, oSnap] = await tx.getAll(plRef, orderRef);
    const pl = plSnap!.data() as Doc; const order = must(oSnap!.data() as Doc | undefined, 'Order not found');
    if (pl.type !== 'bopis') fail('Only click-and-collect orders are held for pickup');
    if (pl.status !== 'packed') fail(`Pick list is ${pl.status}; pick, pack and verify first`);
    tx.update(plRef, { status: 'ready_for_pickup', pickupCode: code, codeAttempts: 0, readyAt: Timestamp.fromDate(readyAt), holdUntil: Timestamp.fromDate(holdUntil) });
    const units = patchUnit(order.units, i.pickListId, { status: 'ready_for_pickup' });
    tx.update(orderRef, { units, status: rollup(order, units), updatedAt: stamp(), timeline: timeline(`Ready for pickup at ${pl.locationName} until ${holdUntil.toISOString().slice(0, 16).replace('T', ' ')} UTC`) });
    audit(tx, c, { action: 'bopis_ready', entity: 'pickLists', entityId: i.pickListId, before: { status: 'packed' }, after: { status: 'ready_for_pickup', holdUntil: holdUntil.toISOString() } });
    return { mobile: order.customer?.mobile as string | undefined, name: order.customer?.name as string, orderName: pl.orderName as string, store: pl.locationName as string };
  });
  let notified = 'no mobile on order';
  if (out.mobile) notified = (await messaging.send({ channel: 'whatsapp', to: `+91${out.mobile}`, refType: 'bopis', refId: i.pickListId, body: `Hi ${out.name.split(' ')[0]}! Your Texa Fashions order ${out.orderName} is ready at ${out.store}. Show code ${code} at the counter within ${BOPIS_HOLD_HOURS}h. 🧸` })).status;
  return { status: 'ready_for_pickup', holdUntil: holdUntil.toISOString(), notified, pickupCode: code };
}

/** Counter handover: verifies the customer's code (5 wrong tries lock it), invoices, issues stock. Pay-at-store orders take a tender here. */
export async function collectBopis(c: Caller, i: z.output<typeof CollectBopisInput>) {
  requireOps(c);
  const plRef = col('pickLists').doc(i.pickListId);
  const pre = must((await plRef.get()).data() as Doc | undefined, 'Pick list not found');
  requireLocation(c, pre.locationId);
  if (pre.status !== 'ready_for_pickup') fail(`Pick list is ${pre.status}`);
  if ((pre.codeAttempts ?? 0) >= 5) fail('Too many wrong codes — ask a manager to verify the customer’s ID and cancel/re-issue');
  if (pre.holdUntil && (pre.holdUntil as Timestamp).toMillis() < Date.now()) fail('The 48-hour hold has expired');
  if (!safeEqual(String(pre.pickupCode), i.code.trim())) {
    await plRef.update({ codeAttempts: FieldValue.increment(1) });
    throw new HttpsError('permission-denied', `Wrong pickup code (${4 - (pre.codeAttempts ?? 0)} tries left)`);
  }
  if (pre.paymentMode === 'cod' && !i.paidAtStore) fail('This order is pay-at-store: collect payment (cash / UPI / card) before handover');
  const loc = await getLoc(pre.locationId);
  const gstin = loc.gstinId ? ((await col('gstins').doc(loc.gstinId).get()).data() as Doc | undefined)?.gstin ?? null : null;
  const orderRef = col('webOrders').doc(pre.orderId);
  return db.runTransaction(async (tx) => {
    const [plSnap, oSnap] = await tx.getAll(plRef, orderRef);
    const pl = plSnap!.data() as Doc; const order = must(oSnap!.data() as Doc | undefined, 'Order not found');
    if (pl.status !== 'ready_for_pickup') fail(`Pick list is ${pl.status}`);
    const tender = pl.paymentMode === 'cod' ? i.paidAtStore!.mode : 'WEB';
    const r = await invoiceAndIssue(tx, c, { pl, plId: i.pickListId, intraState: true, tender, refType: 'bopis', refId: i.pickListId, sellerGstin: gstin });
    tx.update(plRef, { status: 'collected', invoiceNo: r.invoice.number, invoice: r.invoice, journalId: r.journalId, collectedAt: stamp(), collectedBy: c.uid, paidAtStore: i.paidAtStore ?? null });
    const units = patchUnit(order.units, i.pickListId, { status: 'collected' });
    tx.update(orderRef, { units, status: rollup(order, units), financialStatus: 'paid', updatedAt: stamp(), timeline: timeline(`Collected at ${pl.locationName} · invoice ${r.invoice.number}`) });
    audit(tx, c, { action: 'bopis_collected', entity: 'pickLists', entityId: i.pickListId, before: { status: 'ready_for_pickup' }, after: { invoice: r.invoice.number, payablePaise: pl.payablePaise, tender } });
    return { status: 'collected', invoiceNo: r.invoice.number, payablePaise: pl.payablePaise };
  });
}

/** Hourly: holds past 48h are released back to stock; prepaid orders are flagged for refund. */
export async function expireBopisCore(c: Caller, force = false) {
  const q = await col('pickLists').where('status', '==', 'ready_for_pickup').get();
  const due = q.docs.filter((d) => force || ((d.get('holdUntil') as Timestamp | undefined)?.toMillis() ?? 0) < Date.now());
  const expired: string[] = [];
  for (const d of due) {
    try {
      await db.runTransaction(async (tx) => {
        const orderRef = col('webOrders').doc(d.get('orderId'));
        const [plSnap, oSnap] = await tx.getAll(d.ref, orderRef);
        const pl = plSnap!.data() as Doc; const order = must(oSnap!.data() as Doc | undefined, 'Order not found');
        if (pl.status !== 'ready_for_pickup') return;
        const eng = await StockEngine.load(tx, (pl.lines as Doc[]).map((l) => [pl.locationId, l.skuId] as [string, string]), { ignoreLock: true });
        for (const l of pl.lines as Doc[]) eng.move({ locationId: pl.locationId, skuId: l.skuId, bucket: 'reserved', qty: -Math.min(l.qty, eng.get(pl.locationId, l.skuId).reserved ?? 0), kind: 'move', refType: 'webOrderBopis', refId: d.id, reason: 'Pickup hold expired' });
        eng.commit(tx, c);
        tx.update(d.ref, { status: 'expired', expiredAt: stamp() });
        const units = patchUnit(order.units, d.id, { status: 'expired' });
        const refundDue = order.paymentMode === 'prepaid' && order.financialStatus === 'paid';
        tx.update(orderRef, { units, status: rollup(order, units), refundDue, updatedAt: stamp(), timeline: timeline(`Pickup hold expired — stock released${refundDue ? ', refund due' : ''}`) });
        audit(tx, c, { action: 'bopis_expired', entity: 'pickLists', entityId: d.id, before: { status: 'ready_for_pickup' }, after: { status: 'expired', refundDue } });
      });
      expired.push(d.id);
    } catch (e) { console.error('expire bopis failed', d.id, e); }
  }
  return { checked: q.size, expired: expired.length, ids: expired };
}
export async function expireBopis(c: Caller, i: z.output<typeof ExpireBopisInput>) {
  requireOps(c); return expireBopisCore(c, !!i.force);
}
export { OMS_SYSTEM };
