'use client';
import * as React from 'react';
import Fuse from 'fuse.js';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, FlowStepper, Input, Select, Skeleton, cn, toast } from '@texafashions/ui';
import { FLOW_STEPS, type CommandInput, type CommandName, type FlowState, type ScmCollection } from '@texafashions/types';
import type { Row, ScmQuery } from '@texafashions/data';
import { data } from '@/lib/data';
import { useSession } from '@/lib/stores';

/** Whole rupees stay unpadded (₹499); anything with paise always shows two decimals (₹2,952.60). */
export const inr = (paise: number | undefined | null) => (paise === undefined || paise === null ? '—' : '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }));
export const minor = (cur: string, m: number | undefined | null) => (m === undefined || m === null ? '—' : cur === 'INR' ? inr(m) : `${cur} ${(m / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
export const dateStr = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/** Live (snapshot-driven) rows for a collection. `null` while loading. */
export function useRows<T = Record<string, any>>(collection: ScmCollection, q: ScmQuery = {}, enabled = true): Row<T>[] | null {
  const [rows, setRows] = React.useState<Row<T>[] | null>(null);
  const key = JSON.stringify(q);
  React.useEffect(() => {
    if (!enabled) return;
    setRows(null);
    return data().scm.subscribe<T>(collection, q, (r) => setRows([...r].sort((a: any, b: any) => String(b.createdAt ?? b.at ?? b.runAt ?? '').localeCompare(String(a.createdAt ?? a.at ?? a.runAt ?? '')))));
  }, [collection, key, enabled]);
  return rows;
}
/** Query clause that keeps store-scoped roles inside the rules' scope (rules need the filter to be provable). */
export function useScope() {
  const claims = useSession((s) => s.session!.claims);
  const all = ['super_admin', 'cfo', 'buyer', 'warehouse_manager', 'auditor', 'hr_manager'].includes(claims.role);
  return { all, claims, storeIds: claims.storeIds, where: (field: string): [string, 'in', unknown][] => (all ? [] : [[field, 'in', claims.storeIds.length ? claims.storeIds : ['__none__']]]) };
}
export function useDoc<T = Record<string, any>>(collection: ScmCollection, id: string | null) {
  const [row, setRow] = React.useState<Row<T> | null | undefined>(undefined);
  React.useEffect(() => { if (!id) return; setRow(undefined); return data().scm.subscribeDoc<T>(collection, id, setRow); }, [collection, id]);
  return row;
}
/** Runs a command with toast feedback. Returns the result, or null on failure. */
export function useCommand() {
  const [busy, setBusy] = React.useState(false);
  const run = React.useCallback(async <K extends CommandName>(name: K, input: CommandInput<K>, ok?: string | ((r: Record<string, any>) => string)) => {
    setBusy(true);
    try { const r = await data().scm.command(name, input); if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); return r; }
    catch (e) { toast((e as Error).message, 'err'); return null; }
    finally { setBusy(false); }
  }, []);
  return { run, busy };
}
export function useSkus() {
  const q = useQuery({ queryKey: ['skus-all'], queryFn: () => data().masters.list('skus', { limit: 3000 }), staleTime: 120_000 });
  const map = React.useMemo(() => new Map((q.data ?? []).map((s) => [s.id, s])), [q.data]);
  return { skus: q.data ?? [], map, name: (id: string) => String(map.get(id)?.name ?? id), loading: q.isLoading };
}
export function useMaster(master: string) {
  const q = useQuery({ queryKey: ['master-all', master], queryFn: () => data().masters.list(master, { limit: 1500 }), staleTime: 120_000 });
  return { rows: q.data ?? [], map: new Map((q.data ?? []).map((r) => [r.id, r])), loading: q.isLoading };
}

const TONES: Record<string, 'mint' | 'butter' | 'blush' | 'sky' | 'lavender' | 'cherry' | 'ink'> = {
  approved: 'mint', posted: 'mint', matched: 'mint', paid: 'mint', done: 'mint', received: 'mint', converted: 'sky', acknowledged: 'mint', sent: 'sky', in_transit: 'sky', issued: 'mint', dispatched: 'mint', reconciled: 'mint', open: 'sky', counted: 'lavender',
  pending_approval: 'butter', pending_qc: 'butter', pending: 'butter', draft: 'lavender', partially_received: 'butter', partially_paid: 'butter', partial: 'butter', rework: 'butter', counting: 'butter', received_with_variance: 'butter', overridden: 'butter', at_gate: 'sky',
  hold: 'cherry', rejected: 'blush', cancelled: 'blush', critical: 'cherry', high: 'butter', normal: 'lavender',
};
export const StatusBadge = ({ status }: { status?: string }) => <Badge tone={TONES[status ?? ''] ?? 'lavender'}>{(status ?? '—').replace(/_/g, ' ')}</Badge>;

export interface Col<T> { key: string; header: string; cell?: (r: Row<T>) => React.ReactNode; align?: 'right'; mobile?: 'title' | 'hide' }
export function DataTable<T = Record<string, any>>({ cols, rows, onRow, empty, limit = 200 }: { cols: Col<T>[]; rows: Row<T>[] | null; onRow?: (r: Row<T>) => void; empty?: React.ReactNode; limit?: number }) {
  if (rows === null) return <Card className="p-4"><div className="flex flex-col gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div></Card>;
  if (!rows.length) return <Card>{empty ?? <EmptyState kind="bunny" title="Nothing here yet" />}</Card>;
  const shown = rows.slice(0, limit);
  const cell = (c: Col<T>, r: Row<T>) => (c.cell ? c.cell(r) : String((r as any)[c.key] ?? '—'));
  return (
    <>
      <Card className="hidden overflow-x-auto p-0 md:block">
        <table className="w-full text-sm">
          <thead className="bg-card2 text-left text-xs text-soft"><tr>{cols.map((c) => <th key={c.key} className={cn('px-4 py-3 font-medium', c.align === 'right' && 'text-right')}>{c.header}</th>)}</tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id} onClick={onRow ? () => onRow(r) : undefined} className={cn('border-t border-line/60', onRow && 'cursor-pointer hover:bg-card2/60')}>
              {cols.map((c) => <td key={c.key} className={cn('px-4 py-2.5 align-middle', c.align === 'right' && 'num')}>{cell(c, r)}</td>)}
            </tr>))}</tbody>
        </table>
        {rows.length > limit && <p className="p-3 text-center text-xs text-soft">Showing {limit} of {rows.length}</p>}
      </Card>
      <div className="grid gap-3 md:hidden">
        {shown.slice(0, 60).map((r) => (
          <Card key={r.id} className="p-4" onClick={onRow ? () => onRow(r) : undefined}>
            <div className="font-medium">{cell(cols[0]!, r)}</div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">{cols.slice(1).filter((c) => c.mobile !== 'hide').map((c) => <div key={c.key}><dt className="text-soft">{c.header}</dt><dd>{cell(c, r)}</dd></div>)}</dl>
          </Card>
        ))}
      </div>
    </>
  );
}

/** SKU search box (Fuse over the loaded catalogue) that adds a SKU to a list. */
export function SkuSearch({ onPick, placeholder = 'Search SKU by name, code or barcode…' }: { onPick: (skuId: string) => void; placeholder?: string }) {
  const { skus } = useSkus();
  const [q, setQ] = React.useState('');
  const fuse = React.useMemo(() => new Fuse(skus, { keys: ['name', 'code', 'barcode'], threshold: 0.3 }), [skus]);
  const hits = q.trim().length > 1 ? fuse.search(q.trim(), { limit: 6 }).map((h) => h.item) : [];
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search SKU" />
      {hits.length > 0 && (
        <ul className="glass absolute z-20 mt-1 w-full overflow-hidden rounded-2xl shadow-soft">
          {hits.map((h) => <li key={h.id}><button type="button" className="flex w-full justify-between px-4 py-2 text-left text-sm hover:bg-blush/40" onClick={() => { onPick(h.id); setQ(''); }}><span>{String(h.name)}</span><span className="text-xs text-soft">{h.id}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}

export interface LineState { skuId: string; qty: number; price?: number /* major units */ }
export function LinesEditor({ lines, setLines, withPrice, currency = 'INR' }: { lines: LineState[]; setLines: (l: LineState[]) => void; withPrice?: boolean; currency?: string }) {
  const { name } = useSkus();
  return (
    <div className="flex flex-col gap-2">
      <SkuSearch onPick={(id) => !lines.some((l) => l.skuId === id) && setLines([...lines, { skuId: id, qty: 1, price: 0 }])} />
      {lines.length === 0 && <p className="text-xs text-soft">Add at least one SKU.</p>}
      {lines.map((l, i) => (
        <div key={l.skuId} className="grid grid-cols-[1fr_88px_auto] items-center gap-2 sm:grid-cols-[1fr_96px_120px_auto]">
          <div className="min-w-0"><p className="truncate text-sm font-medium">{name(l.skuId)}</p><p className="text-xs text-soft">{l.skuId}</p></div>
          <Input type="number" min={1} value={l.qty} aria-label="Quantity" className="num" onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Math.max(0, Math.floor(Number(e.target.value))) } : x)))} />
          {withPrice && <Input type="number" min={0} step="0.01" value={l.price ?? 0} aria-label={`Unit price (${currency})`} className="num" onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)))} />}
          <Button type="button" variant="ghost" size="sm" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</Button>
        </div>
      ))}
    </div>
  );
}

/** PR → PO → ASN → GRN → QC → Invoice → Paid, driven by `flow` on the PO. */
export function FlowTracker({ flow, className }: { flow?: FlowState | null; className?: string }) {
  const f = flow ?? {};
  const last = FLOW_STEPS.reduce((acc, s, i) => (f[s] ? i : acc), -1);
  const current = f.Paid ? FLOW_STEPS.length : Math.min(last + 1, FLOW_STEPS.length - 1);
  return (
    <Card className={cn('p-4', className)}>
      <FlowStepper steps={[...FLOW_STEPS]} current={current} subs={FLOW_STEPS.map((s) => { const n = f[s]?.number; return n ? (n.includes('/') ? `${n.split('/')[0]} ${n.split('/').slice(-1)[0]}` : n) : undefined; })} />
    </Card>
  );
}

export function Tabbed<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: React.ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return <div className="flex w-full gap-1 overflow-x-auto rounded-pill bg-card2 p-1">{tabs.map((t) => <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)} className={cn('whitespace-nowrap rounded-pill px-4 py-1.5 text-sm', value === t.value ? 'bg-card shadow-soft' : 'text-soft hover:text-ink')}>{t.label}</button>)}</div>;
}
export function PageHead({ title, sub, actions, back }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>{back && <a href={back.href} className="text-xs text-soft hover:text-cherry">← {back.label}</a>}<h1 className="font-display text-3xl">{title}</h1>{sub && <p className="text-sm text-soft">{sub}</p>}</div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </header>
  );
}
export function FieldRow({ children }: { children: React.ReactNode }) { return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>; }
export const LocationSelect = ({ value, onChange, locations, id }: { value: string; onChange: (v: string) => void; locations: { id: string; name: string }[]; id?: string }) => (
  <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Location">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
);
/** Stores + warehouse the current user may see. */
export function useLocations() {
  const stores = useMaster('stores'); const whs = useMaster('warehouses');
  return React.useMemo(() => [...whs.rows.map((w) => ({ id: w.id, name: String(w.name), state: String(w.state ?? '') })), ...stores.rows.map((s) => ({ id: s.id, name: String(s.name), state: String(s.state ?? '') }))], [stores.rows, whs.rows]);
}
export function printHtml(title: string, body: string, css = '') {
  const w = window.open('', '_blank', 'width=900,height=700'); if (!w) { toast('Allow pop-ups to print', 'info'); return; }
  w.document.write(`<html><head><title>${title}</title><style>body{font-family:Inter,system-ui,sans-serif;color:#2b2633;padding:24px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}th{background:#f7f1ea}.r{text-align:right}h1{font-size:20px;margin:0}small{color:#666}${css}</style></head><body>${body}<script>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
