'use client';
import * as React from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Select } from '@texafashions/ui';
import { DataTable, LocationSelect, PageHead, StatusBadge, inr, useCommand, useRows, useScope, useLocations } from '@/components/scm/kit';
import { useRouter } from 'next/navigation';

const URG = { critical: 0, high: 1, normal: 2 } as Record<string, number>;
export default function ReplenishmentPage() {
  const scope = useScope(); const locs = useLocations().filter((l) => scope.all || scope.storeIds.includes(l.id)); const router = useRouter();
  const [loc, setLoc] = React.useState(''); React.useEffect(() => { if (!loc && locs[0]) setLoc(locs[0].id); }, [locs.length]);  
  const rows = useRows('replenishmentSuggestions', { where: [['locationId', '==', loc], ['status', '==', 'open']], limit: 400 }, !!loc);
  const { run, busy } = useCommand(); const [picked, setPicked] = React.useState<Set<string>>(new Set()); const [urg, setUrg] = React.useState('');
  const list = (rows ?? []).filter((r) => !urg || r.urgency === urg).sort((a, b) => (URG[a.urgency] ?? 9) - (URG[b.urgency] ?? 9) || b.estCostPaise - a.estCostPaise);
  const role = scope.claims.role; const canRun = ['buyer', 'warehouse_manager', 'store_manager', 'super_admin'].includes(role);
  const sel = list.filter((r) => picked.has(r.id));
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHead back={{ href: '/scm', label: 'Supply chain' }} title="Replenishment suggestions" sub="Forecast demand (seasonal), safety stock, open POs/PRs and in-transit stock decide what to order. Runs nightly at 02:00 IST." actions={canRun && <Button size="sm" loading={busy} onClick={() => run('runReplenishment', { storeId: loc }, (r) => `${r.suggestions} suggestions (${r.critical} critical)`)}><RefreshCw className="size-4" />Run now for this location</Button>} />
      <div className="flex flex-wrap items-center gap-3"><div className="w-64"><LocationSelect value={loc} onChange={(v) => { setLoc(v); setPicked(new Set()); }} locations={locs} /></div>
        <Select className="w-40" value={urg} onChange={(e) => setUrg(e.target.value)} aria-label="Urgency"><option value="">All urgencies</option><option value="critical">Critical</option><option value="high">High</option><option value="normal">Normal</option></Select>
        <span className="ml-auto text-sm text-soft">{list.length} open · est. {inr(list.reduce((a, r) => a + r.estCostPaise, 0))}</span></div>
      {sel.length > 0 && <Card className="flex flex-wrap items-center justify-between gap-3 bg-mint/40 p-4"><span className="text-sm"><Sparkles className="mr-1 inline size-4" />{sel.length} selected · {sel.reduce((a, r) => a + r.suggestQty, 0)} units · {inr(sel.reduce((a, r) => a + r.estCostPaise, 0))}</span>
        <Button disabled={busy} onClick={async () => { const r = await run('convertSuggestions', { storeId: loc, suggestionIds: sel.map((s) => s.id) }, (x) => `${x.number} → ${x.status.replace('_', ' ')}`); if (r) { setPicked(new Set()); router.push('/scm/purchase?tab=requisitions'); } }}>Convert to requisition</Button></Card>}
      <DataTable rows={rows === null ? null : list} limit={120} cols={[
        { key: 'sel', header: '', cell: (r) => <input type="checkbox" aria-label={`Select ${r.skuId}`} className="size-4 accent-[var(--cherry)]" checked={picked.has(r.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /> },
        { key: 'name', header: 'Item', cell: (r) => <><b className="font-medium">{r.name}</b><br /><span className="text-xs text-soft" title={r.reason}>{r.reason}</span></> },
        { key: 'urgency', header: 'Urgency', cell: (r) => <StatusBadge status={r.urgency} /> }, { key: 'onHand', header: 'On hand', align: 'right' }, { key: 'onOrder', header: 'On order', align: 'right' }, { key: 'inTransit', header: 'In transit', align: 'right' },
        { key: 'dailyDemand', header: 'Demand/day', align: 'right' }, { key: 'daysOfCover', header: 'Cover (d)', align: 'right' }, { key: 'suggestQty', header: 'Suggest', align: 'right', cell: (r) => <b>{r.suggestQty}</b> },
        { key: 'source', header: 'Source', cell: (r) => <Badge tone={r.source === 'warehouse' ? 'mint' : 'sky'}>{r.source === 'warehouse' ? 'from warehouse' : 'buy from vendor'}</Badge> }, { key: 'estCostPaise', header: 'Est. cost', align: 'right', cell: (r) => inr(r.estCostPaise) },
      ]} empty={<EmptyState kind="capybara" title="Nothing to replenish" hint="Stock positions are healthy at this location." />} />
      <p className="text-xs text-soft">Suggestions come from a seasonal moving-average forecast computed in a scheduled Cloud Function. Warehouse-sourced lines are best fulfilled via a stock transfer; vendor-sourced lines via a requisition.</p>
    </div>
  );
}
