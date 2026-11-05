/** Super Admin demo controls. Everything goes through the real handlers (completeSaleCore, simulateWebOrder, alert fan-out). */
import { HttpsError } from 'firebase-functions/v2/https';
import type { DemoControlInput, DemoControlResult } from '@texafashions/types';
import { FieldValue, col, requireRole, type Caller } from './admin';
import { recipients } from './ai/insights';
import { simulateWebOrder } from './oms/simulate';
import { completeSaleCore } from './pos/sale';
import { openShift } from './pos/shift';

const BUSY_STORE = 'PUN-PMC';
const BUSY_TILL = `${BUSY_STORE}-T1`;
const BUSY_MINUTES = 10;
const SALES = 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Store Twin crowd: the twin sim watches this doc and plays the 7 pm peak while `busyUntil` is in the future. */
async function busyHour(c: Caller): Promise<DemoControlResult> {
  await col('settings').doc('demo').set({ busyUntil: Date.now() + BUSY_MINUTES * 60_000, busyBy: c.uid }, { merge: true });

  const till = (await col('tills').doc(BUSY_TILL).get()).data() as { openShiftId?: string | null } | undefined;
  if (!till) throw new HttpsError('failed-precondition', `Till ${BUSY_TILL} not found — run the seed first`);
  const shiftId = till.openShiftId ?? (await openShift(c, { tillId: BUSY_TILL, storeId: BUSY_STORE, openingFloatPaise: 200_000 })).id;

  const stock = await col('stock').where('locationId', '==', BUSY_STORE).where('onHand', '>', 4).limit(60).get();
  const ids = stock.docs.map((d) => d.get('skuId') as string);
  const skus = ids.length ? await Promise.all(ids.map((id) => col('skus').doc(id).get())) : [];
  const pool = skus.filter((s) => s.exists && !s.get('isService') && (s.get('pricePaise') ?? 0) <= 99_900).map((s) => s.id);
  if (pool.length < 2) throw new HttpsError('failed-precondition', `${BUSY_STORE} has no stock to sell`);

  const run = Date.now().toString(36);
  for (let n = 0; n < SALES; n++) {
    const lines = [0, 1].map((k) => ({ lineId: `L${k + 1}`, skuId: pool[(n * 3 + k * 5) % pool.length]!, qty: 1 + ((n + k) % 2) }));
    // ₹5,000 cash covers any 2-line basket under ₹1,000 a unit; the till gives change.
    await completeSaleCore(c, { clientSaleId: `busy-${run}-${n}`, storeId: BUSY_STORE, tillId: BUSY_TILL, shiftId, lines, payments: [{ mode: 'CASH', amountPaise: 500_000 }] } as never);
    await sleep(1200);
  }
  return { message: `${SALES} POS sales posted at ${BUSY_STORE} and the Store Twin crowd is at peak for ${BUSY_MINUTES} min` };
}

async function criticalAlert(): Promise<DemoControlResult> {
  const key = `demo-critical-${Date.now()}`;
  const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const cand = {
    ruleId: 'cash_variance' as const, severity: 'critical' as const, storeId: BUSY_STORE, dedupeKey: key, audience: ['cfo', 'store_manager'],
    title: `Cash drawer short ₹1,250 at ${BUSY_STORE} (demo trigger)`,
    detail: `Till ${BUSY_TILL} closed ₹1,250 under expected cash, 8× the ₹50 tolerance. Triggered from Demo controls.`,
  };
  const base = { ruleId: cand.ruleId, severity: cand.severity, storeId: cand.storeId, title: cand.title, detail: cand.detail, link: null, suggestion: null };
  const batch = col('aiInsights').firestore.batch();
  batch.set(col('aiInsights').doc(key), { ...base, audience: cand.audience, day, status: 'open', source: 'demo', data: null, createdAt: FieldValue.serverTimestamp() });
  const to = recipients(cand);
  for (const u of to) batch.set(col('inbox').doc(`${u.uid}_${key}`), { ...base, userId: u.uid, insightId: key, status: 'new', assignedTo: null, snoozedUntil: null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { message: `Critical alert sent to ${to.length} inboxes — open the bell and tap “Ask why”` };
}

export async function demoControl(c: Caller, i: DemoControlInput): Promise<DemoControlResult> {
  requireRole(c, 'super_admin');
  if (i.action === 'busy_hour') return busyHour(c);
  if (i.action === 'web_orders') { await simulateWebOrder(c, { scenario: 'prepaid', count: 5 }); return { message: '5 Shopify web orders ingested — see E-commerce / OMS' }; }
  return criticalAlert();
}
