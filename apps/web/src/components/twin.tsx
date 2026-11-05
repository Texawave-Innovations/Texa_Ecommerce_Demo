'use client';
import * as React from 'react';
import { gsap } from 'gsap';
import { useReducedMotion } from 'framer-motion';
import { Badge, Card, CountUp, Kpi, Select, Skeleton, Tabs } from '@texafashions/ui';
import {
  ACTIVITY_EMOJI, accumulateDwell, centroid, conversionPct, heatLevel, isCashWrap, queueStats, staffSuggestion, zoneCounts,
  formatINR, type TwinMeta, type TwinPerson, type TwinZone,
} from '@texafashions/domain';
import { data } from '@/lib/data';
import { PageHead, useMaster } from './scm/kit';

/* ───────── Isometric projection: floor plan units (400×260) → SVG px. Avatars/labels stay upright. */
const S = 0.95, OX = 232, OY = 14, TILE_H = 7;
const iso = (x: number, y: number, z = 0) => ({ x: (x - y) * 0.866 * S + OX, y: (x + y) * 0.5 * S + OY - z });
const pts = (poly: { x: number; y: number }[], z: number) => poly.map((p) => { const q = iso(p.x, p.y, z); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' ');
const shrink = (z: TwinZone, f = 0.95) => { const c = centroid(z); return z.polygon.map((p) => ({ x: c.x + (p.x - c.x) * f, y: c.y + (p.y - c.y) * f })); };
const PLATE = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 260 }, { x: 0, y: 260 }];
const PASTELS = ['#F7C6D0', '#FCE7A8', '#BFE6D6', '#C7DDF5', '#D9CCF2'];
const INK = '#2B2633', CHERRY = '#E5486B';
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const FLOOR_NAMES: Record<string, string> = { F1: 'Ground', F2: 'First' };

interface StoreRow { id: string; name?: unknown; floors?: { id: string; name: string }[]; zones?: TwinZone[] }

/* ───────── One avatar: React renders it, GSAP walks it between 1 Hz samples. */
function Walker({ p, reduce }: { p: TwinPerson; reduce: boolean | null }) {
  const ref = React.useRef<SVGGElement>(null);
  const seen = React.useRef(false);
  const q = iso(p.x, p.y, TILE_H);
  React.useEffect(() => {
    const el = ref.current; if (!el) return;
    if (!seen.current || reduce) { gsap.set(el, { x: q.x, y: q.y }); if (!seen.current && !reduce) gsap.fromTo(el, { opacity: 0, scale: 0.2 }, { opacity: 1, scale: 1, duration: 0.4, svgOrigin: `${q.x} ${q.y}` }); seen.current = true; return; }
    gsap.to(el, { x: q.x, y: q.y, duration: 0.98, ease: 'none', overwrite: 'auto' });
  }, [q.x, q.y, reduce]);
  const staff = p.k === 's';
  return (
    <g ref={ref} data-person={p.id}>
      <ellipse cx={0} cy={1.5} rx={staff ? 5 : 4} ry={1.8} fill={INK} opacity={0.15} />
      <circle cx={0} cy={-4} r={staff ? 5.2 : 4.2} fill={staff ? CHERRY : PASTELS[hash(p.id) % PASTELS.length]} stroke={staff ? '#fff' : INK} strokeOpacity={staff ? 1 : 0.35} strokeWidth={staff ? 1.4 : 0.8} />
      <text x={0} y={-11.5} fontSize={8.5} textAnchor="middle" style={{ pointerEvents: 'none' }}>{ACTIVITY_EMOJI[p.a]}</text>
    </g>
  );
}

/** Concentric rings that expand from the till when a real POS sale lands. */
function Ripple({ at, label, onDone }: { at: { x: number; y: number }; label: string; onDone: () => void }) {
  const g = React.useRef<SVGGElement>(null);
  React.useEffect(() => {
    const el = g.current; if (!el) return;
    const rings = el.querySelectorAll('ellipse');
    const tl = gsap.timeline({ onComplete: onDone });
    rings.forEach((r, i) => tl.fromTo(r, { attr: { rx: 4, ry: 2 }, opacity: 0.9 }, { attr: { rx: 46, ry: 23 }, opacity: 0, duration: 1.3, ease: 'power2.out' }, i * 0.25));
    tl.fromTo(el.querySelector('text'), { y: 0, opacity: 1 }, { y: -26, opacity: 0, duration: 1.6, ease: 'power1.out' }, 0);
    return () => { tl.kill(); };
  }, [onDone]);
  return (
    <g ref={g} transform={`translate(${at.x} ${at.y})`}>
      {[0, 1, 2].map((i) => <ellipse key={i} cx={0} cy={0} rx={4} ry={2} fill="none" stroke={CHERRY} strokeWidth={2.2} opacity={0} />)}
      <text x={0} y={-12} textAnchor="middle" fontSize={11} fontWeight={700} fill={CHERRY}>{label}</text>
    </g>
  );
}

function IsoFloor({ zones, people, heat, showHeat, selected, onSelect, ripples, dropRipple, reduce }: {
  zones: TwinZone[]; people: TwinPerson[]; heat: Record<string, number>; showHeat: boolean; selected: string | null; onSelect: (id: string) => void;
  ripples: { key: number; label: string; at: { x: number; y: number } }[]; dropRipple: (k: number) => void; reduce: boolean | null;
}) {
  const counts = zoneCounts(people);
  const q = queueStats(people);
  const ordered = [...zones].sort((a, b) => { const ca = centroid(a), cb = centroid(b); return ca.x + ca.y - (cb.x + cb.y); });
  const sorted = [...people].sort((a, b) => a.x + a.y - (b.x + b.y));
  return (
    <svg viewBox="0 0 464 340" className="w-full" role="img" aria-label="Isometric store floor with live shopper positions">
      <polygon points={pts(PLATE, -10)} fill={INK} opacity={0.12} />
      <polygon points={pts(PLATE, -2)} fill="#E8DCD0" />
      <polygon points={pts(PLATE, 0)} fill="#FFF6EF" stroke={INK} strokeOpacity={0.5} strokeWidth={1.6} strokeLinejoin="round" />
      {ordered.map((z) => {
        const base = PASTELS[hash(z.name) % PASTELS.length]!;
        const poly = shrink(z), c = iso(centroid(z).x, centroid(z).y, TILE_H);
        const lvl = heatLevel(heat, z.id), n = counts[z.id];
        return (
          <g key={z.id} onClick={() => onSelect(z.id)} style={{ cursor: 'pointer' }}>
            <polygon points={pts(poly, 0)} fill={base} stroke={base} strokeWidth={4} strokeLinejoin="round" style={{ filter: 'brightness(0.78)' }} />
            <polygon points={pts(poly, TILE_H)} fill={base} stroke={base} strokeWidth={4} strokeLinejoin="round" />
            {showHeat && <polygon points={pts(poly, TILE_H)} fill={CHERRY} opacity={0.08 + lvl * 0.62} stroke={CHERRY} strokeWidth={4} strokeLinejoin="round" style={{ transition: 'opacity .6s' }} />}
            {selected === z.id && <polygon points={pts(poly, TILE_H)} fill="none" stroke={INK} strokeWidth={2} strokeDasharray="4 3" strokeLinejoin="round" />}
            <text x={c.x} y={c.y - 14} textAnchor="middle" fontSize={9.5} fontWeight={600} fill={INK}>{z.name}{n ? ` · ${n.customers + n.staff}` : ''}</text>
            {isCashWrap(z) && q.length > 0 && <text x={c.x} y={c.y - 3} textAnchor="middle" fontSize={8.5} fill={INK}>queue {q.length} · ~{q.waitSec}s</text>}
          </g>
        );
      })}
      {sorted.map((p) => <Walker key={p.id} p={p} reduce={reduce} />)}
      {ripples.map((r) => <Ripple key={r.key} at={r.at} label={r.label} onDone={() => dropRipple(r.key)} />)}
    </svg>
  );
}

/* ───────── Screen */
export function StoreTwin() {
  const storesM = useMaster('stores');
  const stores = storesM.rows as unknown as StoreRow[];
  const [storeId, setStoreId] = React.useState('PUN-PMC');
  const store = stores.find((s) => s.id === storeId);
  const zones = React.useMemo(() => (store?.zones ?? []) as TwinZone[], [store]);
  const floors = React.useMemo(() => store?.floors?.length ? store.floors : [{ id: 'F1', name: 'Ground' }], [store]);
  const [floor, setFloor] = React.useState('F1');
  const [showHeat, setShowHeat] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [byFloor, setByFloor] = React.useState<Record<string, TwinPerson[]>>({});
  const [meta, setMeta] = React.useState<TwinMeta | null>(null);
  const [lastAt, setLastAt] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const [heat, setHeat] = React.useState<Record<string, number>>({});
  const [ripples, setRipples] = React.useState<{ key: number; label: string; at: { x: number; y: number } }[]>([]);
  const [lastBill, setLastBill] = React.useState<{ at: number; paise: number } | null>(null);
  const reduce = useReducedMotion();
  const flipRef = React.useRef<HTMLDivElement>(null);
  const homeFloor = floors[0]!.id;

  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 2000); return () => clearInterval(t); }, []);
  React.useEffect(() => { setFloor(homeFloor); setSelected(null); setByFloor({}); setMeta(null); setLastAt(0); setHeat({}); }, [storeId, homeFloor]);

  React.useEffect(() => {
    const twin = data().twin;
    const subs = floors.map((f) => twin.subscribePeople(storeId, f.id, (people, at) => {
      setByFloor((m) => ({ ...m, [f.id]: people }));
      setHeat((h) => accumulateDwell(h, people));
      if (at) setLastAt((a) => Math.max(a, at));
    }));
    subs.push(twin.subscribeMeta(storeId, setMeta));
    return () => subs.forEach((u) => u());
  }, [storeId, floors]);

  const tillZone = zones.find((z) => z.floorId === homeFloor && isCashWrap(z));
  React.useEffect(() => data().twin.subscribeNewSales(storeId, (sale) => {
    setLastBill({ at: Date.now(), paise: sale.payablePaise });
    if (!tillZone) return;
    const c = centroid(tillZone);
    setRipples((r) => [...r, { key: Date.now(), label: `+${formatINR(sale.payablePaise)}`, at: iso(c.x, c.y, TILE_H) }]);
  }), [storeId, tillZone]);

  const switchFloor = (f: string) => {
    if (f === floor) return;
    const el = flipRef.current;
    if (!el || reduce) { setFloor(f); return; }
    gsap.to(el, { rotateY: 90, duration: 0.22, ease: 'power2.in', onComplete: () => { setFloor(f); gsap.fromTo(el, { rotateY: -90 }, { rotateY: 0, duration: 0.32, ease: 'power2.out' }); } });
  };

  const live = lastAt > 0 && now - lastAt < 8000;
  const here = byFloor[floor] ?? [];
  const all = Object.values(byFloor).flat();
  const homePeople = byFloor[homeFloor] ?? [];
  const q = queueStats(homePeople);
  const floorZones = zones.filter((z) => z.floorId === floor);
  const counts = zoneCounts(all);
  const sel = zones.find((z) => z.id === selected);
  const tip = staffSuggestion(all, zones, meta);
  const cust = (l: TwinPerson[]) => l.filter((p) => p.k === 'c').length;
  const dropRipple = React.useCallback((k: number) => setRipples((r) => r.filter((x) => x.key !== k)), []);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHead title="Store Twin" sub="Anonymous live footfall on the floor plan — shoppers (pastel), staff (cherry), queue at the till, dwell heatmap and sale ripples from real POS bills."
        actions={<div className="flex items-center gap-2"><Badge tone={live ? 'mint' : 'butter'}>{live ? '● Live · 1 Hz' : 'Simulator offline'}</Badge>
          <Select aria-label="Store" value={storeId} onChange={(e) => setStoreId(e.target.value)} className="w-64">{stores.map((s) => <option key={s.id} value={s.id}>{String(s.name ?? s.id)}</option>)}</Select></div>} />
      {storesM.loading ? <Skeleton className="h-[420px]" /> : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          <Card className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Tabs value={floor} onChange={switchFloor} items={floors.map((f) => ({ value: f.id, label: `${f.id} · ${f.name || FLOOR_NAMES[f.id] || f.id}` }))} />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="lavender">Store <CountUp value={cust(all)} className="font-semibold" /></Badge>
                <Badge tone="sky">Floor {floor} <CountUp value={cust(here)} className="font-semibold" /></Badge>
                <Badge tone="blush">{sel ? sel.name : 'Zone'} <CountUp value={sel ? (counts[sel.id]?.customers ?? 0) : 0} className="font-semibold" /></Badge>
                <button type="button" aria-pressed={showHeat} onClick={() => setShowHeat((v) => !v)}
                  className={`rounded-pill px-3 py-1 text-xs font-medium ${showHeat ? 'bg-cherry text-white' : 'bg-card2 text-ink'}`}>Dwell heatmap</button>
              </div>
            </div>
            {!live && <p className="rounded-2xl bg-butter/50 px-3 py-2 text-xs text-ink">No live feed for this store. Start the footfall simulator: <code>pnpm twin:sim {storeId}</code> (<code>pnpm demo</code> already runs it for PUN-PMC and MUM-PMC).</p>}
            <div style={{ perspective: 1200 }}>
              <div ref={flipRef} style={{ transformStyle: 'preserve-3d' }}>
                <IsoFloor key={`${storeId}-${floor}`} zones={floorZones} people={here} heat={heat} showHeat={showHeat} selected={selected} onSelect={setSelected}
                  ripples={floor === homeFloor ? ripples : []} dropRipple={dropRipple} reduce={reduce} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-soft">
              <span><span className="mr-1 inline-block size-2.5 rounded-full" style={{ background: PASTELS[0] }} />Shopper</span>
              <span><span className="mr-1 inline-block size-2.5 rounded-full" style={{ background: CHERRY }} />Staff</span>
              {Object.entries(ACTIVITY_EMOJI).map(([k, e]) => <span key={k}>{e} {k}</span>)}
              {lastBill && floor !== homeFloor && <span className="font-medium text-cherry">New POS bill {formatINR(lastBill.paise)} at Cash Wrap (floor {homeFloor})</span>}
            </div>
          </Card>
          <div className="flex flex-col gap-4">
            <Kpi label="Conversion today" tone="mint" value={conversionPct(meta)} format={(n) => `${n.toFixed(1)}%`} hint={meta ? `${meta.billsToday} bills / ${meta.entriesToday} entries` : 'Waiting for feed'} />
            <Card>
              <p className="text-xs font-medium text-soft">Cash Wrap queue</p>
              <div className="mt-1 flex items-baseline gap-4">
                <div><CountUp value={q.length} className="font-display text-3xl" /><span className="ml-1 text-xs text-soft">waiting</span></div>
                <div><CountUp value={q.waitSec} format={(n) => `${Math.round(n)}s`} className="font-display text-3xl" /><span className="ml-1 text-xs text-soft">est. wait</span></div>
              </div>
            </Card>
            <Card className={tip.tone === 'cherry' ? 'ring-2 ring-cherry/40' : ''}>
              <div className="flex items-center justify-between"><p className="text-xs font-medium text-soft">Staff suggestion</p><Badge tone={tip.tone}>{tip.tone === 'mint' ? 'All good' : 'Act now'}</Badge></div>
              <p className="mt-2 text-sm" aria-live="polite">{tip.text}</p>
            </Card>
            <Card>
              <p className="mb-2 text-xs font-medium text-soft">Zones on floor {floor}</p>
              <ul className="flex flex-col gap-1 text-sm">
                {floorZones.map((z) => (
                  <li key={z.id}><button type="button" onClick={() => setSelected(z.id)} className={`flex w-full items-center justify-between rounded-xl px-2 py-1 text-left ${selected === z.id ? 'bg-card2' : ''}`}>
                    <span>{z.name}</span><span className="tabular-nums text-soft">{counts[z.id]?.customers ?? 0} · {counts[z.id]?.staff ?? 0} staff</span></button></li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
