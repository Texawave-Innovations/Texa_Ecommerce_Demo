import { Timestamp, col } from '../admin';
import { requireRoles } from '../engine';
import type { Caller } from '../admin';
import { computeWebStock } from './stockPush';
import type { Doc } from '../oms/orders';

const pct = (a: number[], p: number) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!; };
const ms = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : null);

/** Everything the sync-health dashboard needs that is not a simple live collection: lag percentiles, SKU drift vs Shopify, SLA breaches, open COD cash. */
export async function syncHealthReport(c: Caller) {
  requireRoles(c, 'warehouse_manager', 'cfo', 'buyer', 'auditor');
  const now = Date.now(); const since = Timestamp.fromMillis(now - 24 * 3600_000);
  const [h, ev, failed, runs, last, openPl, cod, rto, orders, bopis, web] = await Promise.all([
    col('syncHealth').doc('shopify').get(), col('shopifyEvents').where('receivedAt', '>=', since).get(), col('failedEvents').where('status', 'in', ['retrying', 'dead']).get(),
    col('stockPushRuns').orderBy('at', 'desc').limit(5).get(), col('shopifyStock').get(), col('pickLists').where('status', 'in', ['open', 'picked', 'packed']).get(),
    col('shipments').where('codStatus', 'in', ['with_courier', 'short_paid']).get(), col('rtoCases').where('status', 'in', ['at_origin', 'pending_qc', 'in_transit_back']).get(),
    col('webOrders').where('status', 'in', ['new', 'awaiting_stock']).get(), col('pickLists').where('status', '==', 'ready_for_pickup').get(), computeWebStock(),
  ]);
  const by: Record<string, number> = {}; const topics: Record<string, number> = {}; const lags: number[] = [];
  for (const d of ev.docs) { by[d.get('status')] = (by[d.get('status')] ?? 0) + 1; topics[d.get('topic')] = (topics[d.get('topic')] ?? 0) + 1; const l = d.get('lagMs'); if (typeof l === 'number') lags.push(l); }
  const lastPushed = new Map(last.docs.map((d) => [d.id, d.get('pushedQty') as number]));
  const drift = [...web.sellable].filter(([sku, q]) => lastPushed.has(sku) && lastPushed.get(sku) !== q).map(([sku, q]) => ({ skuId: sku, pushed: lastPushed.get(sku)!, now: q }));
  const neverPushed = [...web.sellable.keys()].filter((s) => !lastPushed.has(s)).length;
  const lastRun = runs.docs[0]; const lastPushAt = ms(lastRun?.get('at'));
  const breaches = openPl.docs.filter((d) => (ms(d.get('slaDueAt')) ?? Infinity) < now);
  const expiring = bopis.docs.filter((d) => (ms(d.get('holdUntil')) ?? Infinity) - now < 6 * 3600_000);
  const codOpen = cod.docs.map((d) => d.data() as Doc);
  const codDays = codOpen.map((d) => (ms(d.deliveredAt) ? Math.floor((now - ms(d.deliveredAt)!) / 86_400_000) : 0));
  const stuckNew = orders.docs.filter((d) => d.get('status') === 'new' && now - (ms(d.get('createdAt')) ?? now) > 15 * 60_000).length;
  const dead = failed.docs.filter((d) => d.get('status') === 'dead').length; const retrying = failed.size - dead;
  const issues: { level: 'red' | 'amber'; text: string }[] = [];
  if (dead) issues.push({ level: 'red', text: `${dead} event(s) exhausted retries (dead letter) — needs a person` });
  if (lastPushAt === null) issues.push({ level: 'amber', text: 'Stock has never been pushed to Shopify' });
  else if (now - lastPushAt > 2 * 3600_000) issues.push({ level: 'red', text: `Last stock push was ${Math.round((now - lastPushAt) / 60_000)} min ago` });
  else if (now - lastPushAt > 30 * 60_000) issues.push({ level: 'amber', text: `Last stock push was ${Math.round((now - lastPushAt) / 60_000)} min ago` });
  if (drift.length > 25) issues.push({ level: 'red', text: `${drift.length} SKUs differ from what Shopify shows — oversell risk` }); else if (drift.length) issues.push({ level: 'amber', text: `${drift.length} SKU(s) changed since the last push` });
  if (retrying) issues.push({ level: 'amber', text: `${retrying} event(s) waiting to retry` });
  if (breaches.length) issues.push({ level: 'amber', text: `${breaches.length} pick list(s) past the ${24}h dispatch SLA` });
  if (stuckNew) issues.push({ level: 'amber', text: `${stuckNew} order(s) unallocated for over 15 min` });
  if (orders.docs.some((d) => d.get('status') === 'awaiting_stock')) issues.push({ level: 'amber', text: `${orders.docs.filter((d) => d.get('status') === 'awaiting_stock').length} order(s) awaiting stock` });
  if (codDays.some((d) => d >= 7)) issues.push({ level: 'amber', text: `${codDays.filter((d) => d >= 7).length} COD parcel(s) delivered 7+ days ago, cash not yet remitted` });
  const verdict = issues.some((i) => i.level === 'red') ? 'red' : issues.length ? 'amber' : 'green';
  const hd = h.data() as Doc | undefined;
  return {
    verdict, issues, generatedAt: new Date(now).toISOString(),
    webhooks: { last24h: ev.size, byStatus: by, byTopic: topics, lagP50Ms: pct(lags, 50), lagP95Ms: pct(lags, 95), lastAt: ms(hd?.lastWebhookAt) ? new Date(ms(hd?.lastWebhookAt)!).toISOString() : null, totals: { processed: hd?.processed ?? 0, failed: hd?.failed ?? 0, duplicates: hd?.duplicates ?? 0 } },
    failed: { retrying, dead, oldestMinutes: failed.size ? Math.round((now - Math.min(...failed.docs.map((d) => ms(d.get('firstFailedAt')) ?? now))) / 60_000) : 0 },
    stock: { skusMapped: web.variants.size, neverPushed, drift: drift.slice(0, 15), driftCount: drift.length, lastPushAt: lastPushAt ? new Date(lastPushAt).toISOString() : null, lastRun: lastRun ? { pushed: lastRun.get('pushed'), failed: lastRun.get('failed'), durationMs: lastRun.get('durationMs'), trigger: lastRun.get('trigger') } : null },
    fulfilment: { slaBreaches: breaches.length, awaitingStock: orders.docs.filter((d) => d.get('status') === 'awaiting_stock').length, stuckNew, bopisExpiringSoon: expiring.length, bopisReady: bopis.size, rtoOpen: rto.size },
    cod: { openParcels: codOpen.length, openPaise: codOpen.reduce((a, d) => a + (d.codAmountPaise ?? 0), 0), oldestDays: codDays.length ? Math.max(...codDays) : 0, disputed: codOpen.filter((d) => d.codStatus === 'short_paid').length },
  };
}
