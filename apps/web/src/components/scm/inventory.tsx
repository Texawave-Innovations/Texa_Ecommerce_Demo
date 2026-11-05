'use client';
import * as React from 'react';
import Fuse from 'fuse.js';
import { Gift, Plus, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Select, SlideOver, Skeleton } from '@texafashions/ui';
import { BUCKET_LABELS, atp, type AgeingRow, type CoverCell, type StockDoc, type ValuationRow } from '@texafashions/types';
import { data } from '@/lib/data';
import { useSession } from '@/lib/stores';
import { DecideButtons } from './purchase';
import { DataTable, FieldRow, LocationSelect, StatusBadge, dateStr, inr, useCommand, useLocations, useMaster, useRows, useScope, useSkus } from './kit';

type Doc = Record<string, any>;
const useVisibleLocations = () => { const locs = useLocations(); const s = useScope(); return locs.filter((l) => s.all || s.storeIds.includes(l.id)); };
function useLocationState() { const locs = useVisibleLocations(); const [loc, setLoc] = React.useState(''); React.useEffect(() => { if (!loc && locs[0]) setLoc(locs[0].id); }, [locs.length]);   return { locs, loc, setLoc }; }

// ───────────────────────── Stock by location with states + ledger drill-down
export function StockTab() {
  const { locs, loc, setLoc } = useLocationState(); const { map } = useSkus(); const role = useSession((s) => s.session!.claims.role);
  const rows = useRows<StockDoc>('stock', { where: [['locationId', '==', loc]], limit: 500 }, !!loc);
  const [q, setQ] = React.useState(''); const [low, setLow] = React.useState(false);
  const [ledger, setLedger] = React.useState<StockDoc | null>(null); const [adj, setAdj] = React.useState<StockDoc | null>(null); const { run } = useCommand();
  const list = React.useMemo(() => (rows ?? []).map((r) => ({ ...r, name: String(map.get(r.skuId)?.name ?? r.skuId), blind: !!map.get(r.skuId)?.isBlindBox })), [rows, map]);
  const fuse = React.useMemo(() => new Fuse(list, { keys: ['name', 'skuId'], threshold: 0.3 }), [list]);
  const shown = (q.trim() ? fuse.search(q.trim()).map((h) => h.item) : list).filter((r) => !low || r.onHand <= 3);
  const totals = shown.reduce((a, r) => ({ onHand: a.onHand + r.onHand, value: a.value + (r.onHand + r.inQC) * r.avgCostPaise, qc: a.qc + r.inQC, dmg: a.dmg + r.damaged }), { onHand: 0, value: 0, qc: 0, dmg: 0 });
  const canAdjust = ['store_manager', 'warehouse_manager', 'super_admin'].includes(role);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64"><LocationSelect value={loc} onChange={setLoc} locations={locs} /></div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items…" className="max-w-xs" aria-label="Search stock" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--cherry)]" checked={low} onChange={(e) => setLow(e.target.checked)} />Low stock (≤ 3)</label>
        <span className="ml-auto text-sm text-soft">{shown.length} SKUs · {totals.onHand.toLocaleString('en-IN')} on hand · {inr(totals.value)}</span>
      </div>
      <DataTable rows={rows === null ? null : shown} limit={150} onRow={setLedger} cols={[
        { key: 'name', header: 'Item', cell: (r: any) => <><b className="font-medium">{r.name}</b><br /><span className="text-xs text-soft">{r.skuId}</span></> },
        { key: 'onHand', header: BUCKET_LABELS.onHand, align: 'right', cell: (r) => <b>{r.onHand}</b> }, { key: 'reserved', header: BUCKET_LABELS.reserved, align: 'right' },
        { key: 'atp', header: 'ATP', align: 'right', cell: (r) => <span className={atp(r) === 0 ? 'text-cherry' : ''}>{atp(r)}</span> },
        { key: 'inTransit', header: BUCKET_LABELS.inTransit, align: 'right' }, { key: 'inQC', header: BUCKET_LABELS.inQC, align: 'right' }, { key: 'damaged', header: BUCKET_LABELS.damaged, align: 'right' }, { key: 'tester', header: BUCKET_LABELS.tester, align: 'right' },
        { key: 'avgCostPaise', header: 'Avg cost', align: 'right', cell: (r) => inr(r.avgCostPaise) },
        { key: 'extra', header: loc === 'WH-CENTRAL' ? 'Bins' : 'Blind box', cell: (r: any) => (loc === 'WH-CENTRAL' ? <span className="text-xs">{Object.entries(r.bins ?? {}).map(([b, n]) => `${b.replace('BIN-', '')}:${n}`).join(' ') || '—'}{(r.unputaway ?? 0) > 0 && <Badge tone="butter" className="ml-1">{r.unputaway} to put away</Badge>}</span> : r.blind ? <span className="text-xs">sealed {r.onHand - (r.revealed ?? 0)} · revealed {r.revealed ?? 0}</span> : '—') },
        { key: 'act', header: '', cell: (r: any) => (
          <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {r.blind && canAdjust && r.onHand - (r.revealed ?? 0) > 0 && <Button size="sm" variant="ghost" aria-label="Reveal a blind box" onClick={() => run('revealBlindBox', { locationId: loc, skuId: r.skuId, qty: 1 }, 'Box revealed')}><Gift className="size-4" /></Button>}
            {canAdjust && <Button size="sm" variant="ghost" aria-label="Adjust stock" onClick={() => setAdj(r)}><SlidersHorizontal className="size-4" /></Button>}
          </span>) },
      ]} empty={<EmptyState kind="bear" title="No stock records" hint="Nothing stocked at this location yet." />} />
      <SlideOver open={!!ledger} onClose={() => setLedger(null)} width={640} title={ledger ? `Ledger · ${map.get(ledger.skuId)?.name ?? ledger.skuId}` : ''}>{ledger && <LedgerView stock={ledger} />}</SlideOver>
      <Dialog open={!!adj} onClose={() => setAdj(null)} title="Adjust stock">{adj && <AdjustForm stock={adj} onDone={() => setAdj(null)} />}</Dialog>
    </div>
  );
}
function LedgerView({ stock }: { stock: StockDoc }) {
  const rows = useRows('stockLedger', { where: [['locationId', '==', stock.locationId], ['skuId', '==', stock.skuId]], limit: 200 });
  return (
    <div className="flex flex-col gap-3">
      <Card className="grid grid-cols-3 gap-2 bg-card2 p-4 text-center text-sm">{(['onHand', 'inQC', 'inTransit', 'damaged', 'tester', 'reserved'] as const).map((b) => <div key={b}><p className="text-xs text-soft">{BUCKET_LABELS[b]}</p><p className="font-display text-xl">{stock[b]}</p></div>)}</Card>
      <p className="text-xs text-soft">Append-only. Every row is a stock movement written in the same transaction as the document that caused it.</p>
      {rows === null ? <Skeleton className="h-40" /> : !rows.length ? <EmptyState kind="bunny" title="No movements" /> : (
        <ol className="flex flex-col gap-2">{rows.map((r) => (
          <li key={r.id} className="rounded-2xl border border-line bg-card p-3 text-sm">
            <div className="flex items-center justify-between"><span className="flex items-center gap-2"><Badge tone={r.kind === 'receipt' || r.kind === 'opening' ? 'mint' : r.kind === 'issue' ? 'blush' : 'lavender'}>{r.kind}</Badge><span className="text-soft">{BUCKET_LABELS[r.bucket as keyof typeof BUCKET_LABELS] ?? r.bucket}</span></span>
              <span className={`num font-medium ${r.qty < 0 ? 'text-cherry' : ''}`}>{r.qty > 0 ? '+' : ''}{r.qty} → {r.balanceAfter}</span></div>
            <p className="mt-1 text-xs text-soft">{r.refType} · {String(r.refId).slice(0, 12)} {r.reason ? `· ${r.reason}` : ''} {r.binId ? `· ${r.binId}` : ''}</p>
            <p className="text-xs text-soft">{dateStr(r.at)} {r.userName ? `· ${r.userName}` : ''}{r.unitCostPaise ? ` · @ ${inr(r.unitCostPaise)}` : ''}</p></li>))}</ol>)}
    </div>
  );
}
function AdjustForm({ stock, onDone }: { stock: StockDoc; onDone: () => void }) {
  const reasons = useMaster('reasonCodes'); const { run, busy } = useCommand(); const { name } = useSkus();
  const [delta, setDelta] = React.useState(-1); const [reason, setReason] = React.useState(''); const [to, setTo] = React.useState(''); const [note, setNote] = React.useState('');
  const r = reasons.map.get(reason); const value = Math.abs(delta) * stock.avgCostPaise;
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const x = await run('postAdjustment', { locationId: stock.locationId, skuId: stock.skuId, qtyDelta: delta, toBucket: (to || null) as 'tester' | null, reasonCode: reason, note: note || null }, (y) => (y.status === 'posted' ? `${y.number} posted` : `${y.number} sent for approval (${String(y.approverRole).replace('_', ' ')})`)); if (x) onDone(); }}>
      <p className="text-sm text-soft">{name(stock.skuId)} · on hand {stock.onHand}</p>
      <FieldRow>
        <Field label="Quantity change" help={to ? `Negative moves on-hand units into ${to}; positive moves them back` : 'Negative = write-off, positive = found stock'}><Input type="number" className="num" value={delta} onChange={(e) => setDelta(Math.trunc(Number(e.target.value)))} /></Field>
        <Field label="Move to bucket"><Select value={to} onChange={(e) => setTo(e.target.value)}><option value="">— (adjust on-hand)</option><option value="tester">Tester</option><option value="damaged">Damaged</option></Select></Field>
        <Field label="Reason code" required><Select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Select…</option>{reasons.rows.filter((x) => x.context === 'stock_adjustment').map((x) => <option key={x.id} value={x.id}>{String(x.name)}{x.needsApproval ? ' (needs approval)' : ''}</option>)}</Select></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </FieldRow>
      <Card className="bg-card2 p-3 text-sm">Value impact {inr(value)} at avg cost{r?.needsApproval ? ' · this reason always needs a second approver' : ''}.</Card>
      <div className="flex justify-end"><Button type="submit" loading={busy} disabled={!delta || !reason}>Submit adjustment</Button></div>
    </form>
  );
}

// ───────────────────────── Valuation
export function ValuationTab() {
  const { locs, loc, setLoc } = useLocationState(); const { run, busy } = useCommand(); const { name } = useSkus();
  const [res, setRes] = React.useState<Record<'WAC' | 'FIFO', { totalPaise: number; totalQty: number; rows: ValuationRow[] } | null>>({ WAC: null, FIFO: null });
  async function go() { const [w, f] = await Promise.all([run('inventoryValuation', { method: 'WAC', locationId: loc }), run('inventoryValuation', { method: 'FIFO', locationId: loc })]); if (w && f) setRes({ WAC: w as never, FIFO: f as never }); }
  React.useEffect(() => { setRes({ WAC: null, FIFO: null }); }, [loc]);
  const diff = res.WAC && res.FIFO ? res.FIFO.totalPaise - res.WAC.totalPaise : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3"><div className="w-64"><LocationSelect value={loc} onChange={setLoc} locations={locs} /></div><Button size="sm" onClick={go} loading={busy}><RefreshCw className="size-4" />Compute valuation</Button></div>
      {!res.WAC ? <Card><EmptyState kind="capybara" title="Pick a location and compute" hint="WAC is the default method; FIFO values on-hand from the newest receipts (landed cost included)." /></Card> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3"><Card><p className="text-xs text-soft">Weighted average cost (default)</p><p className="font-display text-2xl">{inr(res.WAC.totalPaise)}</p><p className="text-xs text-soft">{res.WAC.totalQty.toLocaleString('en-IN')} units</p></Card>
            <Card><p className="text-xs text-soft">FIFO</p><p className="font-display text-2xl">{inr(res.FIFO!.totalPaise)}</p></Card>
            <Card className="bg-card2"><p className="text-xs text-soft">FIFO − WAC</p><p className={`font-display text-2xl ${diff < 0 ? 'text-cherry' : ''}`}>{diff >= 0 ? '+' : ''}{inr(diff)}</p></Card></div>
          <DataTable rows={[...res.WAC.rows].sort((a, b) => b.valuePaise - a.valuePaise).slice(0, 25).map((r) => ({ ...r, id: r.skuId, fifo: res.FIFO!.rows.find((x) => x.skuId === r.skuId)?.valuePaise ?? 0 }))} cols={[
            { key: 'sku', header: 'Top 25 by value', cell: (r: any) => name(r.skuId) }, { key: 'qty', header: 'Qty', align: 'right' }, { key: 'unitCostPaise', header: 'WAC / unit', align: 'right', cell: (r) => inr(r.unitCostPaise) },
            { key: 'valuePaise', header: 'WAC value', align: 'right', cell: (r) => inr(r.valuePaise) }, { key: 'fifo', header: 'FIFO value', align: 'right', cell: (r: any) => inr(r.fifo) }]} />
        </>)}
    </div>
  );
}

// ───────────────────────── Ageing + dead stock
export function AgeingTab() {
  const { locs, loc, setLoc } = useLocationState(); const { run, busy } = useCommand();
  const [res, setRes] = React.useState<{ totals: AgeingRow['buckets']; rows: AgeingRow[]; deadStock: Doc[] } | null>(null);
  React.useEffect(() => setRes(null), [loc]);
  const keys = ['0-30', '31-60', '61-90', '90+'] as const; const max = res ? Math.max(...keys.map((k) => res.totals[k].valuePaise), 1) : 1;
  const colour = { '0-30': 'bg-mint', '31-60': 'bg-sky', '61-90': 'bg-butter', '90+': 'bg-blush' } as const;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3"><div className="w-64"><LocationSelect value={loc} onChange={setLoc} locations={locs} /></div><Button size="sm" loading={busy} onClick={async () => { const r = await run('inventoryAgeing', { locationId: loc }); if (r) setRes(r as never); }}><RefreshCw className="size-4" />Analyse ageing</Button></div>
      {!res ? <Card><EmptyState kind="bunny" title="Analyse stock age" hint="Buckets 0–30 / 31–60 / 61–90 / 90+ days from receipt dates; old, slow stock gets a markdown suggestion." /></Card> : (
        <>
          <Card><h3 className="mb-3 font-medium">Stock value by age</h3><div className="grid gap-3 sm:grid-cols-4">{keys.map((k) => (
            <div key={k}><p className="text-xs text-soft">{k} days</p><p className="font-display text-xl">{inr(res.totals[k].valuePaise)}</p><p className="text-xs text-soft">{res.totals[k].qty.toLocaleString('en-IN')} units</p>
              <div className="mt-2 h-2 rounded-full bg-card2"><div className={`h-2 rounded-full ${colour[k]} transition-all duration-700`} style={{ width: `${(res.totals[k].valuePaise / max) * 100}%` }} /></div></div>))}</div></Card>
          <h3 className="font-display text-lg">Dead-stock alerts & markdown suggestions</h3>
          <DataTable rows={res.deadStock.map((d) => ({ ...d, id: d.skuId }))} cols={[
            { key: 'name', header: 'Item', cell: (r: any) => <><b className="font-medium">{r.name}</b><br /><span className="text-xs text-soft">{r.reason}</span></> }, { key: 'qty90', header: '90+ days qty', align: 'right' },
            { key: 'valuePaise', header: 'Cash tied up', align: 'right', cell: (r: any) => inr(r.valuePaise) }, { key: 'daysOfCover', header: 'Days of cover', align: 'right', cell: (r: any) => (r.daysOfCover > 900 ? '∞' : r.daysOfCover) },
            { key: 'md', header: 'Suggested markdown', cell: (r: any) => <Badge tone="cherry">−{r.suggestedMarkdownPct}%</Badge> }]} empty={<EmptyState kind="capybara" title="No dead stock" />} />
          <p className="text-xs text-soft">Rule-based suggestion (share of 90+ day stock and days of cover). An AI-written rationale is added in the AI phase.</p>
        </>)}
    </div>
  );
}

// ───────────────────────── Days-of-cover heatmap
export function CoverTab() {
  const { run, busy } = useCommand(); const depts = useMaster('departments'); const stores = useMaster('stores');
  const [cells, setCells] = React.useState<CoverCell[] | null>(null);
  React.useEffect(() => { run('coverHeatmap', {}).then((r) => r && setCells((r as any).cells)); }, []);  
  if (!cells) return <Skeleton className="h-64" />;
  const storeIds = [...new Set(cells.map((c) => c.storeId))]; const deptIds = depts.rows.map((d) => d.id).filter((d) => cells.some((c) => c.departmentId === d));
  const tone = (d: number) => (d < 7 ? 'bg-cherry/80 text-cherry-ink' : d < 14 ? 'bg-butter' : d < 45 ? 'bg-mint' : d < 90 ? 'bg-sky' : 'bg-lavender');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between"><p className="text-sm text-soft">Days of cover = on hand ÷ forecast daily demand. Red = stock-out risk, lavender = overstock.</p><Button size="sm" variant="ghost" loading={busy} onClick={() => run('coverHeatmap', {}).then((r) => r && setCells((r as any).cells))}><RefreshCw className="size-4" /></Button></div>
      <Card className="overflow-x-auto p-4"><table className="w-full border-separate border-spacing-1 text-sm">
        <thead><tr><th />{deptIds.map((d) => <th key={d} className="px-2 text-xs font-medium text-soft">{String(depts.map.get(d)?.name ?? d)}</th>)}</tr></thead>
        <tbody>{storeIds.map((s) => <tr key={s}><th className="whitespace-nowrap pr-3 text-left text-xs font-medium">{String(stores.map.get(s)?.name ?? s)}</th>{deptIds.map((d) => { const c = cells.find((x) => x.storeId === s && x.departmentId === d); return <td key={d} title={c ? `${c.onHand} units · ${c.dailyDemand}/day` : ''} className={`rounded-xl px-2 py-3 text-center transition-transform hover:scale-105 ${c ? tone(c.days) : 'bg-card2'}`}>{c ? (c.days > 900 ? '∞' : Math.round(c.days)) : '—'}</td>; })}</tr>)}</tbody></table>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">{[['<7d', 'bg-cherry/80'], ['7–14d', 'bg-butter'], ['14–45d', 'bg-mint'], ['45–90d', 'bg-sky'], ['90d+', 'bg-lavender']].map(([l, c]) => <span key={l} className="flex items-center gap-1"><i className={`inline-block size-3 rounded ${c}`} />{l}</span>)}</div></Card>
    </div>
  );
}

// ───────────────────────── Cycle counts / stock-take (blind)
export function CountsTab() {
  const scope = useScope(); const cc = useRows('cycleCounts', { where: scope.where('locationId') }); const st = useRows('stockTakes', { where: scope.where('locationId') }); const { locs } = useLocationState(); const role = useSession((s) => s.session!.claims.role);
  const rows = cc && st ? [...cc, ...st].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) : null;
  const [form, setForm] = React.useState(false); const [open, setOpen] = React.useState<Doc | null>(null);
  void locs;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><p className="text-sm text-soft">Cycle counts sample SKUs by ABC class. A full stock-take freezes the location until it is reconciled.</p>
        {['store_manager', 'warehouse_manager', 'super_admin'].includes(role) && <Button size="sm" onClick={() => setForm(true)}><Plus className="size-4" />Start count</Button>}</div>
      <DataTable rows={rows} onRow={setOpen} cols={[
        { key: 'number', header: 'Count', cell: (r) => <b className="font-medium">{r.number}</b> }, { key: 'type', header: 'Type', cell: (r) => (r.type === 'full' ? <Badge tone="cherry">full stock-take (frozen)</Badge> : <Badge tone="lavender">cycle {r.abcClass ? `· class ${r.abcClass}` : ''}</Badge>) },
        { key: 'locationId', header: 'Location' }, { key: 'lines', header: 'Lines', align: 'right', cell: (r) => r.lines?.length }, { key: 'variance', header: 'Net variance', align: 'right', cell: (r) => (r.netVariancePaise !== undefined ? inr(r.netVariancePaise) : '—') },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]} empty={<EmptyState kind="bear" title="No counts yet" />} />
      <Dialog open={form} onClose={() => setForm(false)} title="Start a stock count"><StartCountForm onDone={() => setForm(false)} /></Dialog>
      <SlideOver open={!!open} onClose={() => setOpen(null)} width={640} title={open ? `${open.number} · ${open.locationId}` : ''}>{open && <CountSheet id={open.id} coll={open.collection} onDone={() => setOpen(null)} />}</SlideOver>
    </div>
  );
}
function StartCountForm({ onDone }: { onDone: () => void }) {
  const { locs, loc, setLoc } = useLocationState(); const { run, busy } = useCommand(); const [type, setType] = React.useState<'cycle' | 'full'>('cycle'); const [abc, setAbc] = React.useState(''); const [limit, setLimit] = React.useState(20);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('startCount', { type, locationId: loc, abcClass: (abc || null) as 'A' | null, limit }, (x) => `${x.number} started (${x.lines} lines)`); if (r) onDone(); }}>
      <FieldRow><Field label="Location"><LocationSelect value={loc} onChange={setLoc} locations={locs} /></Field><Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as 'cycle')}><option value="cycle">Cycle count (sample)</option><option value="full">Full stock-take (freezes location)</option></Select></Field>
        {type === 'cycle' && <><Field label="ABC class"><Select value={abc} onChange={(e) => setAbc(e.target.value)}><option value="">All classes</option><option value="A">A — top 70% of value</option><option value="B">B — next 20%</option><option value="C">C — long tail</option></Select></Field><Field label="Max lines"><Input type="number" min={1} max={200} className="num" value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></Field></>}</FieldRow>
      {type === 'full' && <Card className="bg-butter/40 p-3 text-sm">⚠ While frozen, no stock movement can be posted at this location (sales, receipts, transfers) until the count is reconciled.</Card>}
      <div className="flex justify-end"><Button type="submit" loading={busy}>Start counting</Button></div>
    </form>
  );
}
function CountSheet({ id, coll, onDone }: { id: string; coll: 'cycleCounts' | 'stockTakes'; onDone: () => void }) {
  const [c, setC] = React.useState<Doc | null>(null); const { run, busy } = useCommand(); const { name } = useSkus(); const [vals, setVals] = React.useState<Record<string, string>>({});
  const reload = React.useCallback(() => { data().scm.get(coll, id).then(setC); }, [id, coll]);
  React.useEffect(reload, [reload]);
  if (!c) return <Skeleton className="h-40" />;
  const lines = c.lines as Doc[]; const counted = c.status !== 'counting';
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-soft">{counted ? 'Counting finished. Review variances, then reconcile to post adjustments.' : 'Blind count: expected quantities are hidden. Enter what you physically count.'}</p>
      {lines.map((l) => { const entered = vals[l.skuId] ?? (l.countedQty ?? ''); const v = counted ? l.countedQty - l.expectedQty : null; return (
        <div key={l.skuId} className="grid grid-cols-[1fr_auto_100px] items-center gap-3 rounded-2xl border border-line bg-card p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{name(l.skuId)}</p><p className="text-xs text-soft">class {l.abc} · {l.skuId}</p></div>
          {counted ? <span className={`num text-sm ${v ? 'font-medium text-cherry' : 'text-soft'}`}>{v ? `${v > 0 ? '+' : ''}${v}` : '✓'} <span className="text-xs text-soft">(exp {l.expectedQty})</span></span> : <span />}
          <Input type="number" min={0} className="num" aria-label={`Count ${l.skuId}`} disabled={c.status === 'reconciled'} value={entered as never} onChange={(e) => setVals({ ...vals, [l.skuId]: e.target.value })} /></div>); })}
      <div className="sticky bottom-0 flex justify-end gap-2 bg-card/80 py-2 backdrop-blur">
        {!['reconciled'].includes(c.status) && <Button variant="outline" loading={busy} onClick={async () => { const counts = Object.entries(vals).filter(([, v]) => v !== '').map(([skuId, v]) => ({ skuId, countedQty: Number(v) })); if (!counts.length) return; const r = await run('submitCount', { countId: id, counts }, (x) => (x.status === 'counted' ? 'All lines counted' : 'Progress saved')); if (r) { setVals({}); reload(); } }}>Save counts</Button>}
        {c.status === 'counted' && <Button loading={busy} onClick={async () => { const r = await run('reconcileCount', { countId: id, reasonCode: 'RC-ADJ-FOUND' }, (x) => `Reconciled · ${x.varianceLines} variance line(s), net ${inr(x.netVariancePaise)}`); if (r) onDone(); }}>Reconcile & post adjustments</Button>}
      </div>
    </div>
  );
}

// ───────────────────────── Adjustments list
export function AdjustmentsTab() {
  const scope = useScope(); const rows = useRows('adjustments', { where: scope.where('locationId') });
  return <DataTable rows={rows} cols={[
    { key: 'number', header: 'Adjustment', cell: (r) => <b className="font-medium">{r.number}</b> }, { key: 'locationId', header: 'Location' }, { key: 'skuName', header: 'Item' },
    { key: 'qtyDelta', header: 'Change', align: 'right', cell: (r) => `${r.qtyDelta > 0 ? '+' : ''}${r.qtyDelta}${r.toBucket ? ` → ${r.toBucket}` : ''}` }, { key: 'reasonName', header: 'Reason' },
    { key: 'valuePaise', header: 'Value', align: 'right', cell: (r) => inr(r.valuePaise) }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'act', header: '', cell: (r) => <DecideButtons collection="adjustments" doc={r} /> },
  ]} empty={<EmptyState kind="capybara" title="No adjustments" />} />;
}
