'use client';
import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import Fuse from 'fuse.js';
import JsBarcode from 'jsbarcode';
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { Copy, Download, History, Pencil, Plus, Printer, ScanSearch, Upload, Power, ArrowUpDown } from 'lucide-react';
import { Badge, Button, Card, Dialog, EmptyState, Input, SlideOver, Skeleton, toast } from '@texafashions/ui';
import { canEditMaster, getMaster, MASTER_MAP, type DuplicateCandidate, type MasterDoc } from '@texafashions/types';
import { data } from '@/lib/data';
import { useSession } from '@/lib/stores';
import { displayCell, toCsv } from '@/lib/masterConvert';
import { MasterForm } from '@/components/MasterForm';
import { ImportDialog } from '@/components/ImportDialog';
import { HistoryDrawer } from '@/components/HistoryDrawer';

export default function MasterPage() {
  const { master } = useParams<{ master: string }>();
  if (!MASTER_MAP[master]) return <EmptyState title="Unknown master" kind="capybara" action={<Link href="/master" className="text-cherry">Back to Master Data</Link>} />;
  return <MasterList key={master} masterKey={master} />;
}

function MasterList({ masterKey }: { masterKey: string }) {
  const def = getMaster(masterKey);
  const role = useSession((s) => s.session!.claims.role);
  const canEdit = canEditMaster(role, masterKey);
  const qc = useQueryClient();
  const [docs, setDocs] = React.useState<MasterDoc[] | null>(null);
  const [search, setSearch] = React.useState('');
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [editing, setEditing] = React.useState<{ doc: MasterDoc | null } | null>(null);
  const [historyId, setHistoryId] = React.useState<string | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [dups, setDups] = React.useState<{ usedClaude: boolean; candidates: DuplicateCandidate[] } | null>(null);
  const [dupBusy, setDupBusy] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  React.useEffect(() => data().masters.subscribe(masterKey, setDocs, { limit: 3000 }), [masterKey]);

  const fuse = React.useMemo(() => new Fuse(docs ?? [], { keys: def.fields.filter((f) => f.list || f.key === def.codeField).map((f) => f.key), threshold: 0.35, ignoreLocation: true }), [docs, def]);
  const rows = React.useMemo(() => (search.trim() ? fuse.search(search.trim()).map((r) => r.item) : docs ?? []), [search, fuse, docs]);

  const columns = React.useMemo<ColumnDef<MasterDoc>[]>(() => [
    ...(def.barcode ? [{ id: 'sel', header: '', cell: ({ row }: { row: { original: MasterDoc } }) => <input type="checkbox" aria-label="Select" checked={selected.has(row.original.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(row.original.id); else n.delete(row.original.id); return n; })} className="size-4 accent-[var(--cherry)]" /> } as ColumnDef<MasterDoc>] : []),
    ...def.fields.filter((f) => f.list).map<ColumnDef<MasterDoc>>((f) => ({
      accessorKey: f.key,
      header: ({ column }) => <button className="inline-flex items-center gap-1" onClick={() => column.toggleSorting()}>{f.label}<ArrowUpDown className="size-3 opacity-50" /></button>,
      cell: ({ getValue }) => <span className={f.type === 'money' || f.type === 'number' ? 'num block' : f.key === def.codeField || f.key === 'barcode' ? 'whitespace-nowrap' : ''}>{displayCell(f, getValue())}</span>,
    })),
    ...(def.shopifySync ? [{ id: 'shopify', header: 'Shopify', cell: ({ row }: { row: { original: MasterDoc } }) => row.original.shopifyVariantId ? <Badge tone="mint">synced</Badge> : <Badge tone="butter">not linked</Badge> } as ColumnDef<MasterDoc>] : []),
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <Badge tone={getValue() === 'inactive' ? 'blush' : 'mint'}>{String(getValue() ?? 'active')}</Badge> },
    { id: 'actions', header: '', cell: ({ row }) => (
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" aria-label="History" onClick={() => setHistoryId(row.original.id)}><History className="size-4" /></Button>
        {canEdit && <Button variant="ghost" size="sm" aria-label="Edit" onClick={() => setEditing({ doc: row.original })}><Pencil className="size-4" /></Button>}
        {canEdit && <Button variant="ghost" size="sm" aria-label="Deactivate" onClick={() => deactivate(row.original)}><Power className="size-4" /></Button>}
      </div>) },
  ], [def, canEdit, selected]);

  const table = useReactTable({ data: rows, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: (r) => r.id });

  async function submit(values: Record<string, unknown>) {
    setSaving(true);
    try {
      const doc = editing?.doc;
      const id = String(doc?.id ?? values[def.codeField]);
      await data().masters.submitChange({ master: def.key, kind: doc ? 'update' : 'create', id, data: values });
      toast('Submitted for approval — switch to an approver role to approve it', 'ok');
      setEditing(null); qc.invalidateQueries({ queryKey: ['pending-count'] });
    } catch (e) { toast((e as Error).message, 'err'); } finally { setSaving(false); }
  }
  async function deactivate(doc: MasterDoc) {
    if (!confirm(`Deactivate ${doc.id}? A checker must approve.`)) return;
    try { await data().masters.submitChange({ master: def.key, kind: 'deactivate', id: doc.id, data: {} }); toast('Deactivation submitted for approval', 'ok'); qc.invalidateQueries({ queryKey: ['pending-count'] }); }
    catch (e) { toast((e as Error).message, 'err'); }
  }
  async function findDups() {
    setDupBusy(true);
    try { setDups(await data().masters.detectDuplicates(def.key)); } catch (e) { toast((e as Error).message, 'err'); } finally { setDupBusy(false); }
  }
  function exportCsv() {
    const blob = new Blob(['﻿' + toCsv(def, rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${def.key}.csv`; a.click();
  }
  function printLabels() {
    const picked = (docs ?? []).filter((d) => selected.has(d.id));
    if (!picked.length) { toast('Tick the SKUs to label first', 'info'); return; }
    const w = window.open('', '_blank', 'width=800,height=600'); if (!w) return;
    const svgs = picked.map((d) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      try { JsBarcode(el, String(d.barcode ?? d.code), { format: 'CODE128', height: 40, fontSize: 12, margin: 0 }); } catch { /* ignore bad code */ }
      return `<div class="l"><b>${esc(String(d.name))}</b><small>${esc(String(d.colour ?? ''))} ${esc(String(d.size ?? ''))}</small>${el.outerHTML}<span>MRP ₹${((d.mrpPaise as number) ?? 0) / 100}</span></div>`;
    }).join('');
    w.document.write(`<html><head><title>Labels</title><style>body{font-family:sans-serif;display:flex;flex-wrap:wrap;gap:6px}.l{width:50mm;height:30mm;border:1px dashed #bbb;padding:2mm;display:flex;flex-direction:column;gap:1mm;font-size:9px;overflow:hidden}.l svg{width:100%;height:12mm}small{color:#555}</style></head><body>${svgs}<script>setTimeout(()=>print(),300)</script></body></html>`);
    w.document.close();
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/master" className="text-xs text-soft hover:text-cherry">← Master Data · {def.group}</Link>
          <h1 className="font-display text-3xl">{def.label} <span className="ml-1 text-lg text-soft num">{docs ? rows.length : ''}</span></h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={findDups} loading={dupBusy}><ScanSearch className="size-4" />Find duplicates</Button>
          {def.barcode && <Button variant="outline" size="sm" onClick={printLabels}><Printer className="size-4" />Labels ({selected.size})</Button>}
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><Download className="size-4" />Export</Button>
          {canEdit && <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="size-4" />Import</Button>}
          {canEdit && <Button size="sm" onClick={() => setEditing({ doc: null })}><Plus className="size-4" />New {def.singular.toLowerCase()}</Button>}
        </div>
      </header>
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${def.label.toLowerCase()}…`} aria-label="Search" className="max-w-md" />

      {docs === null ? (
        <Card className="p-4"><div className="flex flex-col gap-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div></Card>
      ) : !rows.length ? (
        <Card><EmptyState kind="bear" title={search ? 'No matches' : `No ${def.label.toLowerCase()} yet`} hint={canEdit ? 'Create one, or import a CSV / Excel file.' : 'Nothing to show.'} /></Card>
      ) : (
        <>
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full text-sm">
              <thead className="bg-card2 text-left text-xs text-soft">{table.getHeaderGroups().map((hg) => <tr key={hg.id}>{hg.headers.map((h) => <th key={h.id} className="px-4 py-3 font-medium">{flexRender(h.column.columnDef.header, h.getContext())}</th>)}</tr>)}</thead>
              <tbody>{table.getRowModel().rows.slice(0, 300).map((r) => <tr key={r.id} className="border-t border-line/60 hover:bg-card2/60">{r.getVisibleCells().map((c) => <td key={c.id} className="px-4 py-2.5">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}</tr>)}</tbody>
            </table>
            {rows.length > 300 && <p className="p-3 text-center text-xs text-soft">Showing first 300 of {rows.length} — refine your search.</p>}
          </Card>
          <div className="grid gap-3 md:hidden">
            {rows.slice(0, 100).map((d) => (
              <Card key={d.id} className="p-4">
                <div className="flex items-start justify-between"><div><p className="font-medium">{String(d[def.nameField] ?? d.id)}</p><p className="text-xs text-soft">{d.id}</p></div><Badge tone={d.status === 'inactive' ? 'blush' : 'mint'}>{d.status}</Badge></div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">{def.fields.filter((f) => f.list && f.key !== def.nameField && f.key !== def.codeField).slice(0, 4).map((f) => <div key={f.key}><dt className="text-soft">{f.label}</dt><dd className="num !text-left">{displayCell(f, d[f.key])}</dd></div>)}</dl>
                <div className="mt-3 flex gap-1"><Button variant="ghost" size="sm" onClick={() => setHistoryId(d.id)}><History className="size-4" /></Button>{canEdit && <Button variant="ghost" size="sm" onClick={() => setEditing({ doc: d })}><Pencil className="size-4" /></Button>}</div>
              </Card>
            ))}
          </div>
        </>
      )}

      <SlideOver open={!!editing} onClose={() => setEditing(null)} width={640} title={editing?.doc ? `Edit ${def.singular} · ${editing.doc.id}` : `New ${def.singular}`}>
        {editing && <MasterForm def={def} doc={editing.doc} onSubmit={submit} onCancel={() => setEditing(null)} submitting={saving} />}
      </SlideOver>
      <HistoryDrawer def={def} id={historyId} onClose={() => setHistoryId(null)} />
      <ImportDialog def={def} open={importOpen} onClose={() => setImportOpen(false)} onDone={() => qc.invalidateQueries({ queryKey: ['pending-count'] })} />
      <Dialog open={!!dups} onClose={() => setDups(null)} title="Possible duplicates" wide>
        <p className="mb-3 text-xs text-soft">{dups?.usedClaude ? 'Reviewed by Claude (variants of colour/size are not flagged).' : 'Deterministic similarity check (no Claude API key configured).'}</p>
        {!dups?.candidates.length ? <EmptyState kind="capybara" title="No duplicates found" hint="Looking tidy!" /> : (
          <ul className="flex flex-col gap-2">{dups.candidates.map((c) => (
            <li key={c.a + c.b} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line p-3 text-sm">
              <Badge tone={c.score > 0.9 ? 'cherry' : 'butter'}>{Math.round(c.score * 100)}%</Badge>
              <span className="font-medium">{c.a}</span><Copy className="size-3 text-soft" /><span className="font-medium">{c.b}</span><span className="text-soft">— {c.reason}</span>
            </li>))}</ul>
        )}
      </Dialog>
    </div>
  );
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
