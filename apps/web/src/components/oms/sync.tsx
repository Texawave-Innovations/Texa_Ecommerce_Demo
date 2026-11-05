'use client';
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle2, FlaskConical, RefreshCw, UploadCloud } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Kpi, Skeleton, StaggerGrid } from '@texafashions/ui';
import { STOCK_PUSH_POLICY } from '@texafashions/types';
import { data } from '@/lib/data';
import { DataTable, PageHead, useCommand, useRows } from '../scm/kit';
import { HQ_ROLES, OmsNav, ago, dt, useRole, type Doc } from './shared';
import { SimulateButton } from './home';

const VERDICT = { green: { tone: 'mint', label: 'Healthy', Icon: CheckCircle2 }, amber: { tone: 'butter', label: 'Needs attention', Icon: AlertTriangle }, red: { tone: 'blush', label: 'Action required', Icon: AlertTriangle } } as const;
const secs = (ms: number | null) => (ms === null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function SyncHealthView() {
  const role = useRole(); const qc = useQueryClient(); const { run, busy } = useCommand();
  const q = useQuery({ queryKey: ['sync-health'], queryFn: () => data().scm.command('syncHealthReport', {}) as Promise<Doc>, refetchInterval: 20_000, enabled: HQ_ROLES.includes(role) });
  const failed = useRows('failedEvents', {}, HQ_ROLES.includes(role)); const events = useRows('shopifyEvents', { limit: 40 }, HQ_ROLES.includes(role)); const runs = useRows('stockPushRuns', { limit: 8 }, HQ_ROLES.includes(role));
  const refresh = () => qc.invalidateQueries({ queryKey: ['sync-health'] });
  if (!HQ_ROLES.includes(role)) return <div className="mx-auto max-w-3xl"><PageHead title="Sync health" /><Card><EmptyState kind="bunny" title="Head-office roles only" /></Card></div>;
  const h = q.data;
  const canOps = ['super_admin', 'warehouse_manager', 'cfo'].includes(role);
  const active = (failed ?? []).filter((f) => f.status !== 'resolved').sort((a, b) => String(b.lastFailedAt).localeCompare(String(a.lastFailedAt)));
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHead title="Sync health" sub="Shopify ⇄ ERP: webhooks, retry queue and stock push (mock Shopify store in this demo)" actions={<><Button size="sm" variant="soft" onClick={refresh}><RefreshCw className="size-4" />Refresh</Button>{canOps && <SimulateButton />}</>} />
      <OmsNav current="/oms/sync" />
      {!h ? <Skeleton className="h-24" /> : <VerdictCard h={h} />}
      {h && (
        <StaggerGrid className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi label="Webhooks (24 h)" value={h.webhooks.last24h} tone="sky" hint={`lag p50 ${secs(h.webhooks.lagP50Ms)} · p95 ${secs(h.webhooks.lagP95Ms)}`} />
          <Kpi label="Retry queue" value={h.failed.retrying} tone={h.failed.retrying ? 'butter' : 'mint'} hint={`${h.failed.dead} dead-lettered`} />
          <Kpi label="SKUs drifted from Shopify" value={h.stock.driftCount} tone={h.stock.driftCount ? 'butter' : 'mint'} hint={`${h.stock.skusMapped} mapped · last push ${ago(h.stock.lastPushAt)}`} />
          <Kpi label="COD cash with couriers" value={h.cod.openPaise / 100} format={(n) => '₹' + Math.round(n).toLocaleString('en-IN')} tone="lavender" hint={`${h.cod.openParcels} parcels · oldest ${h.cod.oldestDays} d`} />
        </StaggerGrid>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between"><h2 className="font-display text-xl">Stock → Shopify</h2>{canOps && <div className="flex gap-2"><Button size="sm" loading={busy} onClick={async () => { await run('pushStockNow', {}, (x) => `Pushed ${x.pushed} SKU(s), ${x.unchanged} unchanged${x.failed ? `, ${x.failed} failed` : ''}`); refresh(); }}><UploadCloud className="size-4" />Push now</Button>
            <Button size="sm" variant="ghost" loading={busy} onClick={async () => { await run('pushStockNow', { force: true, simulateOutage: true }, (x) => `Outage simulated: ${x.failed} SKU(s) parked for retry`); refresh(); }}><FlaskConical className="size-4" />Simulate outage</Button></div>}</div>
          <p className="text-sm text-soft">Web quantity per SKU = Σ over locations of (on hand − reserved − buffer). Stores keep <b>{STOCK_PUSH_POLICY.storeBuffer}</b> units back for walk-ins, the warehouse <b>{STOCK_PUSH_POLICY.warehouseBuffer}</b>, and the last unit is never sold online. Only changed SKUs are pushed, every 15 minutes (scheduler) or on demand.</p>
          {(h?.stock.drift.length ?? 0) > 0 && <div><p className="mb-1 text-xs font-medium text-soft">Changed since last push</p><ul className="text-xs">{(h!.stock.drift as Doc[]).slice(0, 6).map((d) => <li key={d.skuId} className="flex justify-between border-t border-line/50 py-1"><span>{d.skuId}</span><span className="num">Shopify {d.pushed} → now {d.now}</span></li>)}</ul></div>}
          <DataTable rows={runs} limit={6} empty={<EmptyState kind="capybara" title="No pushes yet" />} cols={[
            { key: 'at', header: 'Run', cell: (r) => <span>{dt(r.at)}<span className="block text-xs text-soft">{r.trigger}</span></span> }, { key: 'pushed', header: 'Pushed', align: 'right' }, { key: 'unchanged', header: 'Unchanged', align: 'right' },
            { key: 'failed', header: 'Failed', align: 'right', cell: (r) => (r.failed ? <span className="text-cherry">{r.failed}</span> : 0) }, { key: 'durationMs', header: 'Took', align: 'right', cell: (r) => secs(r.durationMs) },
          ]} />
        </Card>
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between"><h2 className="font-display text-xl">Retry queue</h2>{canOps && <Button size="sm" variant="soft" loading={busy} onClick={async () => { await run('runRetries', {}, (x) => `${x.due} event(s) were due`); refresh(); }}><Activity className="size-4" />Run due retries</Button>}</div>
          <p className="text-sm text-soft">A verified webhook that fails is acknowledged to Shopify and parked here: retried after 30 s, 1, 2, 4, 8, 16 min, then dead-lettered for a person.</p>
          {active.length === 0 ? <EmptyState kind="bunny" title="Nothing waiting" /> : <ul className="flex flex-col gap-2">{active.slice(0, 8).map((f) => (
            <li key={f.id} className="rounded-2xl bg-card2 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span><b className="font-medium">{f.topic}</b> {f.orderName && <span className="text-soft">{f.orderName}</span>}</span><span className="flex items-center gap-2"><Badge tone={f.status === 'dead' ? 'cherry' : 'butter'}>{f.status === 'dead' ? 'dead letter' : `retry ${f.attempts}/${f.maxAttempts}`}</Badge>{canOps && <Button size="sm" variant="soft" loading={busy} onClick={async () => { await run('retryFailedEvent', { eventId: f.id }, (x) => `Retry → ${x.status}`); refresh(); }}>Retry</Button>}</span></div>
              <p className="mt-1 text-xs text-cherry">{f.error}</p>{f.nextRetryAt && <p className="text-xs text-soft">Next automatic retry {dt(f.nextRetryAt)}</p>}</li>))}</ul>}
        </Card>
      </div>
      {h && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card><h3 className="font-medium">Fulfilment SLA</h3><dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm"><dt className="text-soft">Past dispatch SLA (24 h)</dt><dd className="num">{h.fulfilment.slaBreaches}</dd><dt className="text-soft">Awaiting stock</dt><dd className="num">{h.fulfilment.awaitingStock}</dd><dt className="text-soft">Unallocated &gt; 15 min</dt><dd className="num">{h.fulfilment.stuckNew}</dd><dt className="text-soft">Pickup holds &lt; 6 h left</dt><dd className="num">{h.fulfilment.bopisExpiringSoon}</dd><dt className="text-soft">RTO open</dt><dd className="num">{h.fulfilment.rtoOpen}</dd></dl></Card>
          <Card><h3 className="font-medium">Webhooks by topic (24 h)</h3><ul className="mt-2 text-sm">{Object.entries(h.webhooks.byTopic as Record<string, number>).map(([t, n]) => <li key={t} className="flex justify-between"><span>{t}</span><span className="num">{n}</span></li>)}{!Object.keys(h.webhooks.byTopic).length && <li className="text-soft">None</li>}</ul>
            <p className="mt-2 text-xs text-soft">Lifetime: {h.webhooks.totals.processed} processed · {h.webhooks.totals.failed} failed · {h.webhooks.totals.duplicates} duplicates ignored</p></Card>
          <Card><h3 className="font-medium">Last webhook</h3><p className="mt-2 text-sm">{h.webhooks.lastAt ? `${ago(h.webhooks.lastAt)} (${dt(h.webhooks.lastAt)})` : 'None yet'}</p><p className="text-xs text-soft">Report generated {ago(h.generatedAt)}</p></Card>
        </div>
      )}
      <h2 className="font-display text-xl">Recent events</h2>
      <DataTable rows={events ? [...events].sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))) : null} limit={25} empty={<EmptyState kind="capybara" title="No webhook events" />} cols={[
        { key: 'topic', header: 'Topic', cell: (r) => <span><b className="font-medium">{r.topic}</b><span className="block text-xs text-soft">{r.orderName ?? r.resourceId ?? ''}</span></span> }, { key: 'shop', header: 'Source', cell: (r) => (r.shop === 'demo-simulator' ? <Badge tone="butter">simulator</Badge> : r.shop) },
        { key: 'status', header: 'Status', cell: (r) => <Badge tone={r.status === 'processed' ? 'mint' : r.status === 'failed' ? 'cherry' : 'lavender'}>{r.status}</Badge> },
        { key: 'deliveries', header: 'Deliveries', align: 'right', cell: (r) => r.deliveries ?? 1 }, { key: 'lag', header: 'Lag', align: 'right', cell: (r) => (r.lagMs !== null && r.lagMs !== undefined ? secs(r.lagMs) : '—') }, { key: 'at', header: 'Received', cell: (r) => dt(r.receivedAt) },
      ]} />
    </div>
  );
}

function VerdictCard({ h }: { h: Doc }) {
  const V = VERDICT[h.verdict as keyof typeof VERDICT]; const Icon = V.Icon;
  return (
    <Card className={V.tone === 'mint' ? 'bg-mint/40' : V.tone === 'butter' ? 'bg-butter/50' : 'bg-blush/60'}>
      <div className="flex items-start gap-3"><Icon className="mt-0.5 size-6" /><div><p className="font-display text-xl">{V.label}</p>
        {h.issues.length ? <ul className="mt-1 list-disc pl-5 text-sm">{(h.issues as Doc[]).map((i) => <li key={i.text}>{i.text}</li>)}</ul> : <p className="text-sm">Webhooks flowing, retry queue empty, stock in sync, fulfilment inside SLA.</p>}</div></div>
    </Card>
  );
}
