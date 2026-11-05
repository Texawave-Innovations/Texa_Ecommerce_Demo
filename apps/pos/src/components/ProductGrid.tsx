'use client';
import * as React from 'react';
import Fuse from 'fuse.js';
import { Camera, Search, X, Sparkles } from 'lucide-react';
import { Badge, cn, toast } from '@texafashions/ui';
import { SERVICE_GIFTWRAP_SKU, type PosSku } from '@texafashions/types';
import { flyBus } from '@/lib/events';
import { usePos } from '@/lib/store';
import { inr } from '@/lib/stores';

export const DEPT_NAMES: Record<string, string> = { KLV: 'K-Living', BAG: 'Bags', PLU: 'Plushies', LIF: 'Lifestyle', STA: 'Stationery', CAR: 'Care' };
const PAGE = 48;

export function ProductGrid({ onScan, searchRef }: { onScan: () => void; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const skus = usePos((s) => s.skus); const stock = usePos((s) => s.stock); const addSku = usePos((s) => s.addSku);
  const [q, setQ] = React.useState(''); const [dept, setDept] = React.useState<string>('ALL'); const [limit, setLimit] = React.useState(PAGE);
  const sellable = React.useMemo(() => skus.filter((s) => !s.isService && s.id !== SERVICE_GIFTWRAP_SKU), [skus]);
  const byBarcode = React.useMemo(() => new Map(sellable.map((s) => [s.barcode, s])), [sellable]);
  const fuse = React.useMemo(() => new Fuse(sellable, { keys: ['name', 'code', 'barcode', 'character', 'colour'], threshold: 0.32, ignoreLocation: true }), [sellable]);
  const depts = React.useMemo(() => [...new Set(sellable.map((s) => s.departmentId))].sort(), [sellable]);
  const shown = React.useMemo(() => {
    let list = q.trim() ? fuse.search(q.trim()).map((r) => r.item) : [...sellable].sort((a, b) => Number(!!b.badges?.includes('Bestseller')) - Number(!!a.badges?.includes('Bestseller')) || a.name.localeCompare(b.name));
    if (dept !== 'ALL') list = list.filter((s) => s.departmentId === dept);
    return list;
  }, [q, dept, fuse, sellable]);
  React.useEffect(() => setLimit(PAGE), [q, dept]);

  const add = (sku: PosSku, el?: HTMLElement | null) => {
    addSku(sku, 1);
    if (el) flyBus.emit({ from: el.getBoundingClientRect(), image: sku.imageUrl, label: sku.name });
    const st = stock[sku.id]; if (st && st.onHand <= 0) toast(`${sku.name}: system shows 0 in stock — check shelf`, 'info');
  };
  const onEnter = () => {
    const v = q.trim(); if (!v) return;
    const hit = byBarcode.get(v) ?? sellable.find((s) => s.code.toLowerCase() === v.toLowerCase());
    if (hit) { add(hit, searchRef.current); setQ(''); return; }
    if (shown.length === 1) { add(shown[0]!, searchRef.current); setQ(''); return; }
    toast(/^\d{8,14}$/.test(v) ? `Barcode ${v} not found` : 'Pick an item from the grid', 'err');
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <label className="glass flex h-12 flex-1 items-center gap-2 rounded-pill px-4 shadow-soft">
          <Search className="size-4 text-soft" />
          <input ref={searchRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }} data-testid="search" aria-label="Scan barcode or search products"
            placeholder="Scan barcode or search name, character, colour…" className="h-full flex-1 bg-transparent text-base outline-none placeholder:text-soft" inputMode="search" />
          {q && <button onClick={() => { setQ(''); searchRef.current?.focus(); }} aria-label="Clear search"><X className="size-4 text-soft" /></button>}
        </label>
        <button onClick={onScan} data-testid="scan-btn" className="flex h-12 items-center gap-2 rounded-pill bg-lavender px-4 text-sm font-semibold shadow-soft active:scale-95"><Camera className="size-4" />Scan / Snap</button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {['ALL', ...depts].map((d) => (
          <button key={d} onClick={() => setDept(d)} data-testid={`dept-${d}`} className={cn('shrink-0 rounded-pill px-4 py-2 text-sm font-medium transition active:scale-95', dept === d ? 'bg-ink text-bg' : 'bg-card shadow-soft hover:bg-card2')}>{d === 'ALL' ? 'All' : DEPT_NAMES[d] ?? d}</button>
        ))}
      </div>
      <div className="scroll-y min-h-0 flex-1 pr-1">
        {!sellable.length && <p className="grid h-40 place-items-center text-soft">Loading catalogue…</p>}
        <div className="grid grid-cols-3 gap-3 xl:grid-cols-4">
          {shown.slice(0, limit).map((s) => {
            const st = stock[s.id]?.onHand;
            return (
              <button key={s.id} onClick={(e) => add(s, e.currentTarget)} data-testid={`sku-${s.code}`} aria-label={`Add ${s.name}, ${inr(s.pricePaise)}`}
                className="group flex flex-col overflow-hidden rounded-3xl border border-line/60 bg-card text-left shadow-soft transition active:scale-95">
                <div className="relative aspect-[4/3] bg-card2">
                  {s.imageUrl ? <img src={s.imageUrl} alt="" className="size-full object-cover transition group-hover:scale-105" loading="lazy" /> : null}
                  {s.badges?.[0] && <span className="absolute left-2 top-2"><Badge tone="butter">{s.badges[0]}</Badge></span>}
                  {s.isBlindBox && <span className="absolute right-2 top-2"><Badge tone="lavender">Blind box</Badge></span>}
                  {st !== undefined && st <= 3 && <span className={cn('absolute bottom-2 right-2 rounded-pill px-2 py-0.5 text-[11px] font-semibold', st <= 0 ? 'bg-cherry text-cherry-ink' : 'bg-butter')}>{st <= 0 ? 'Out' : `${st} left`}</span>}
                </div>
                <div className="p-2.5"><div className="line-clamp-2 min-h-[2.4em] text-[13px] font-medium leading-snug">{s.name}</div><div className="mt-1 font-display text-base">{inr(s.pricePaise)}</div></div>
              </button>
            );
          })}
        </div>
        {shown.length > limit && <button onClick={() => setLimit(limit + PAGE)} className="mx-auto mt-4 block rounded-pill bg-card px-5 py-2 text-sm shadow-soft">Show more ({shown.length - limit})</button>}
        {sellable.length > 0 && !shown.length && <p className="grid h-40 place-items-center text-soft">Nothing matches “{q}”.</p>}
      </div>
    </div>
  );
}

export function CrossSellStrip({ items, onAdd }: { items: PosSku[]; onAdd: (s: PosSku, el: HTMLElement) => void }) {
  if (!items.length) return null;
  return (
    <div className="glass flex items-center gap-3 rounded-3xl p-2.5" data-testid="cross-sell">
      <span className="flex shrink-0 items-center gap-1.5 pl-2 text-xs font-semibold text-soft"><Sparkles className="size-4 text-cherry" />Uni suggests</span>
      {items.map((s) => (
        <button key={s.id} onClick={(e) => onAdd(s, e.currentTarget)} className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-card p-1.5 pr-3 text-left shadow-soft active:scale-95">
          {s.imageUrl && <img src={s.imageUrl} alt="" className="size-10 shrink-0 rounded-xl object-cover" />}
          <span className="min-w-0"><span className="block truncate text-xs font-medium">{s.name}</span><span className="text-xs text-soft">{inr(s.pricePaise)}</span></span>
        </button>
      ))}
    </div>
  );
}
