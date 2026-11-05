import { MAX_EVENT_ATTEMPTS, isDeadLetter, mapShopifyOrder, nextRetryAt } from '@texafashions/domain';
import { FieldValue, Timestamp, col, db } from '../admin';
import { OMS_SYSTEM, cancelOrderCore, createWebOrder, type Doc } from '../oms/orders';

type Payload = Record<string, any>;
export interface ShopifyEvent { id: string; topic: string; shop: string; payload: Payload; receivedAt?: Date }
export type IngestResult = { status: 'processed' | 'duplicate' | 'failed' | 'ignored' | 'queued'; detail?: unknown; error?: string };
const safeId = (id: string) => id.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 120);
const stamp = () => FieldValue.serverTimestamp();
const health = col('syncHealth').doc('shopify');

/** Topic → handler. Handlers are idempotent on their own natural key (order id), so a replay after a crash never double-books. */
const HANDLERS: Record<string, (e: ShopifyEvent) => Promise<unknown>> = {
  async 'orders/create'(e) {
    return createWebOrder(OMS_SYSTEM, mapShopifyOrder(e.payload), { source: e.shop === 'demo-simulator' ? 'simulated' : 'shopify', eventId: e.id });
  },
  async 'orders/paid'(e) {
    const ref = col('webOrders').doc(`SH${e.payload.id}`); const s = await ref.get();
    if (!s.exists) throw new Error(`orders/paid arrived before orders/create for ${e.payload.name ?? e.payload.id} — will succeed on retry`);
    await ref.update({ financialStatus: 'paid', updatedAt: stamp(), timeline: FieldValue.arrayUnion({ at: new Date().toISOString(), text: 'Payment confirmed by Shopify' }) });
    return { updated: true };
  },
  async 'orders/cancelled'(e) {
    const id = `SH${e.payload.id}`; const s = await col('webOrders').doc(id).get();
    if (!s.exists) throw new Error(`orders/cancelled arrived before orders/create for ${e.payload.name ?? e.payload.id} — will succeed on retry`);
    return cancelOrderCore(OMS_SYSTEM, { orderId: id, reason: `Cancelled on Shopify${e.payload.cancel_reason ? ` (${e.payload.cancel_reason})` : ''}` });
  },
  async 'refunds/create'(e) {
    const orderId = `SH${e.payload.order_id}`; const ref = col('webOrders').doc(orderId); const s = await ref.get();
    if (!s.exists) throw new Error(`refunds/create for unknown order ${e.payload.order_id} — will succeed on retry`);
    const amount = Math.round(Number(((e.payload.transactions ?? []) as Doc[]).reduce((a, t) => a + Number(t.amount ?? 0), 0)) * 100);
    await ref.update({ refunds: FieldValue.arrayUnion({ id: String(e.payload.id), amountPaise: amount, at: new Date().toISOString() }), updatedAt: stamp(), timeline: FieldValue.arrayUnion({ at: new Date().toISOString(), text: `Refund of ₹${(amount / 100).toLocaleString('en-IN')} recorded from Shopify` }) });
    return { refundPaise: amount };
  },
};
/** ERP is the source of truth for products and stock, so inbound product/inventory/customer events are acknowledged but not applied. */
const IGNORED = new Set(['products/update', 'inventory_levels/update', 'customers/create', 'customers/update', 'app/uninstalled']);

export async function ingestShopifyEvent(ev: ShopifyEvent, opts: { fromRetry?: boolean } = {}): Promise<IngestResult> {
  const id = safeId(ev.id); const evRef = col('shopifyEvents').doc(id);
  const prior = await evRef.get();
  if (prior.exists && !opts.fromRetry) {
    // Same event delivered again (Shopify retries on slow 2xx, or at-least-once delivery): acknowledge, do nothing.
    await evRef.update({ deliveries: FieldValue.increment(1), lastDeliveryAt: stamp() });
    await health.set({ duplicates: FieldValue.increment(1), updatedAt: stamp() }, { merge: true });
    return { status: prior.get('status') === 'failed' ? 'queued' : 'duplicate', detail: { previous: prior.get('status') } };
  }
  const received = ev.receivedAt ?? new Date();
  const created = ev.payload?.created_at ? new Date(ev.payload.created_at as string).getTime() : NaN;
  const base = { topic: ev.topic, shop: ev.shop, orderName: ev.payload?.name ?? null, resourceId: ev.payload?.id !== undefined ? String(ev.payload.id) : null, receivedAt: Timestamp.fromDate(received), lagMs: Number.isFinite(created) ? Math.max(0, received.getTime() - created) : null };
  if (IGNORED.has(ev.topic) || !HANDLERS[ev.topic]) {
    await evRef.set({ ...base, status: 'ignored', deliveries: 1, attempts: 0, note: IGNORED.has(ev.topic) ? 'ERP is the source of truth for this resource' : 'No handler for this topic', processedAt: stamp() });
    return { status: 'ignored' };
  }
  try {
    const detail = await HANDLERS[ev.topic]!(ev);
    await evRef.set({ ...base, status: 'processed', deliveries: (prior.get('deliveries') ?? 0) + 1, attempts: (prior.get('attempts') ?? 0) + 1, result: JSON.parse(JSON.stringify(detail ?? null)), processedAt: stamp() }, { merge: true });
    if (opts.fromRetry) await col('failedEvents').doc(id).set({ status: 'resolved', resolvedAt: stamp() }, { merge: true });
    await health.set({ processed: FieldValue.increment(1), lastWebhookAt: stamp(), lastWebhookTopic: ev.topic, lastLagMs: base.lagMs, updatedAt: stamp() }, { merge: true });
    return { status: 'processed', detail };
  } catch (e) {
    const error = (e as Error).message ?? String(e);
    await recordFailure({ id, kind: 'webhook', topic: ev.topic, shop: ev.shop, error, payload: ev.payload, base });
    return { status: 'failed', error };
  }
}

/** Failure → `failedEvents` (payload kept as JSON) with exponential backoff; the 5-minute scheduler or the dashboard button retries. */
export async function recordFailure(f: { id: string; kind: 'webhook' | 'stock_push'; topic: string; shop?: string; error: string; payload: unknown; base?: Doc }) {
  const fRef = col('failedEvents').doc(f.id); const evRef = col('shopifyEvents').doc(f.id);
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(fRef); const attempts = ((cur.get('attempts') as number | undefined) ?? 0) + 1;
    const dead = isDeadLetter(attempts);
    tx.set(fRef, {
      kind: f.kind, topic: f.topic, shop: f.shop ?? null, error: f.error, attempts, maxAttempts: MAX_EVENT_ATTEMPTS, status: dead ? 'dead' : 'retrying',
      nextRetryAt: dead ? null : Timestamp.fromDate(nextRetryAt(new Date(), attempts)), payloadJson: JSON.stringify(f.payload), orderName: (f.payload as Doc | undefined)?.name ?? null,
      firstFailedAt: cur.exists ? cur.get('firstFailedAt') : stamp(), lastFailedAt: stamp(),
    });
    if (f.kind === 'webhook') tx.set(evRef, { ...(f.base ?? {}), topic: f.topic, shop: f.shop ?? null, status: 'failed', attempts, error: f.error, deliveries: FieldValue.increment(cur.exists ? 0 : 1) }, { merge: true });
  });
  await health.set({ failed: FieldValue.increment(1), lastFailureAt: stamp(), lastFailureError: f.error.slice(0, 300), updatedAt: stamp() }, { merge: true });
}

/** Replays one failed event. Returns the new state. */
export async function retryFailedEvent(eventId: string, opts: { manual?: boolean } = {}) {
  const fRef = col('failedEvents').doc(eventId); const f = await fRef.get();
  if (!f.exists) throw new Error(`No failed event ${eventId}`);
  if (f.get('status') === 'resolved') return { status: 'resolved', already: true };
  const payload = JSON.parse(f.get('payloadJson') as string);
  if (f.get('kind') === 'stock_push') {
    const { pushStock } = await import('./stockPush');
    const r = await pushStock({ skuIds: (payload as { skuIds: string[] }).skuIds, trigger: 'retry', retryId: eventId });
    return { status: r.failed ? 'retrying' : 'resolved', pushed: r.pushed };
  }
  // A manual retry of a dead letter gets a fresh attempt budget.
  if (opts.manual && f.get('status') === 'dead') await fRef.update({ attempts: MAX_EVENT_ATTEMPTS - 1, status: 'retrying' });
  const r = await ingestShopifyEvent({ id: eventId, topic: f.get('topic'), shop: f.get('shop') ?? 'unknown', payload }, { fromRetry: true });
  return { status: r.status === 'processed' ? 'resolved' : r.status, error: r.error };
}

/** Scheduler body: everything due for a retry. */
export async function retryDueEvents(now = new Date()) {
  const q = await col('failedEvents').where('status', '==', 'retrying').where('nextRetryAt', '<=', Timestamp.fromDate(now)).limit(50).get();
  const out: { id: string; status: string }[] = [];
  for (const d of q.docs) { try { out.push({ id: d.id, ...(await retryFailedEvent(d.id)) } as never); } catch (e) { console.error('retry failed', d.id, e); } }
  return { due: q.size, results: out };
}
