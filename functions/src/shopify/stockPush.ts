import { STOCK_PUSH_POLICY, WAREHOUSE_ID } from '@texafashions/types';
import { diffStockPush, webSellableQty, type StockPoint } from '@texafashions/domain';
import { FieldValue, Timestamp, col, db } from '../admin';
import { chunks } from '../util';
import { shopifyAdmin } from './adapter';
import { recordFailure } from './ingest';
import type { Doc } from '../oms/orders';

/** Sellable web quantity per SKU = Σ over locations (onHand − reserved − safety buffer), last unit hidden. Pure maths in domain `webSellableQty`. */
export async function computeWebStock(skuFilter?: string[]) {
  const [stock, skus] = await Promise.all([col('stock').get(), col('skus').get()]);
  const variants = new Map<string, string>(); const sellable = new Map<string, number>();
  for (const s of skus.docs) if (s.get('shopifyVariantId') && s.get('status') !== 'inactive' && (!skuFilter || skuFilter.includes(s.id))) variants.set(s.id, s.get('shopifyVariantId'));
  const points = new Map<string, StockPoint[]>();
  for (const d of stock.docs) {
    const sku = d.get('skuId') as string; if (!variants.has(sku)) continue;
    const arr = points.get(sku) ?? []; arr.push({ kind: d.get('locationId') === WAREHOUSE_ID ? 'warehouse' : 'store', onHand: d.get('onHand') ?? 0, reserved: d.get('reserved') ?? 0 }); points.set(sku, arr);
  }
  for (const sku of variants.keys()) sellable.set(sku, webSellableQty(points.get(sku) ?? [], STOCK_PUSH_POLICY));
  return { sellable, variants };
}

export interface PushOpts { skuIds?: string[] | null; force?: boolean; trigger: 'schedule' | 'manual' | 'retry'; retryId?: string; simulateOutage?: boolean }
const outage = { name: 'Shopify (simulated outage)', setInventory: async (items: { skuId: string }[]) => items.map((i) => ({ skuId: i.skuId, ok: false, error: '503 Service Unavailable (simulated Shopify outage)' })) };
/** Pushes only SKUs whose sellable quantity changed since the last push; failures go to failedEvents (kind stock_push) for the retry scheduler. */
export async function pushStock(o: PushOpts) {
  const t0 = Date.now();
  const { sellable, variants } = await computeWebStock(o.skuIds ?? undefined);
  const lastSnap = await col('shopifyStock').get();
  const last = new Map(lastSnap.docs.map((d) => [d.id, d.get('pushedQty') as number]));
  const { changes, unchanged } = diffStockPush(sellable, last, !!o.force);
  let pushed = 0; const failed: { skuId: string; error: string }[] = [];
  for (const part of chunks(changes, 100)) {
    const res = await (o.simulateOutage ? outage : shopifyAdmin).setInventory(part.map((c) => ({ skuId: c.skuId, variantId: variants.get(c.skuId)!, quantity: c.to })));
    const ok = new Set(res.filter((r) => r.ok).map((r) => r.skuId));
    res.filter((r) => !r.ok).forEach((r) => failed.push({ skuId: r.skuId, error: r.error ?? 'failed' }));
    const batch = db.batch();
    for (const c of part) if (ok.has(c.skuId)) { batch.set(col('shopifyStock').doc(c.skuId), { skuId: c.skuId, variantId: variants.get(c.skuId), pushedQty: c.to, previousQty: c.from, pushedAt: FieldValue.serverTimestamp() }, { merge: true }); pushed++; }
    await batch.commit();
  }
  const run = { trigger: o.trigger, at: FieldValue.serverTimestamp(), skusConsidered: sellable.size, changed: changes.length, pushed, unchanged, failed: failed.length, failures: failed.slice(0, 20), durationMs: Date.now() - t0, adapter: shopifyAdmin.name, policy: STOCK_PUSH_POLICY, sample: changes.slice(0, 8).map((c) => ({ ...c })) };
  const runRef = col('stockPushRuns').doc(); await runRef.set(run);
  await col('syncHealth').doc('shopify').set({ lastStockPushAt: FieldValue.serverTimestamp(), lastStockPushPushed: pushed, lastStockPushFailed: failed.length, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  if (failed.length) await recordFailure({ id: o.retryId ?? `stockpush-${runRef.id}`, kind: 'stock_push', topic: 'stock/push', error: `${failed.length} SKU(s) rejected: ${failed[0]!.error}`, payload: { skuIds: failed.map((f) => f.skuId) } });
  else if (o.retryId) await col('failedEvents').doc(o.retryId).set({ status: 'resolved', resolvedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { runId: runRef.id, pushed, changed: changes.length, unchanged, failed: failed.length, considered: sellable.size, durationMs: Date.now() - t0 };
}
export { Timestamp };
export type { Doc };
