'use client';
import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CountUp, Field, Input, Kpi, Select, Skeleton, StaggerGrid, Tabs } from '@texafashions/ui';
import {
  DEFAULT_BENCHMARK, buildBenchmark, forecastStoreSales, formatINR, projectScenarios,
  type Benchmark, type ProjectionInput, type ProjectionResult, type Scenario,
} from '@texafashions/domain';
import { data } from '@/lib/data';
import { PageHead, useMaster, useSkus } from './scm/kit';

const CITIES: { name: string; tier: 1 | 2 | 3; lat: number; lng: number }[] = [
  { name: 'Chennai', tier: 1, lat: 13.0827, lng: 80.2707 }, { name: 'Delhi NCR', tier: 1, lat: 28.6139, lng: 77.209 }, { name: 'Kolkata', tier: 1, lat: 22.5726, lng: 88.3639 },
  { name: 'Ahmedabad', tier: 1, lat: 23.0225, lng: 72.5714 }, { name: 'Jaipur', tier: 2, lat: 26.9124, lng: 75.7873 }, { name: 'Kochi', tier: 2, lat: 9.9312, lng: 76.2673 },
  { name: 'Indore', tier: 2, lat: 22.7196, lng: 75.8577 }, { name: 'Coimbatore', tier: 2, lat: 11.0168, lng: 76.9558 }, { name: 'Lucknow', tier: 2, lat: 26.8467, lng: 80.9462 },
  { name: 'Bhubaneswar', tier: 3, lat: 20.2961, lng: 85.8245 },
];
const DEFAULTS = { city: 'Chennai', footfall: 1200, size: 1300, rent: 350000, conv: 5, atv: 1100 };
const SCENARIOS: { value: Scenario; label: string }[] = [{ value: 'conservative', label: 'Conservative' }, { value: 'base', label: 'Base' }, { value: 'optimistic', label: 'Optimistic' }];
const inrC = (p: number) => formatINR(p, { compact: true });

/** Benchmark = median seeded store (sales/sq ft, margin, dept mix from real sale lines); see `buildBenchmark` for the sparse-history fallback. */
function useBenchmark() {
  const stores = useMaster('stores');
  const { map: skuMap } = useSkus();
  const sales = useQuery({
    queryKey: ['projection-sales', stores.rows.map((s) => s.id).join()],
    enabled: stores.rows.length > 0,
    queryFn: async () => Object.fromEntries(await Promise.all(stores.rows.map(async (s) => [s.id, await data().pos.recentSales(s.id, 300).catch(() => [])] as const))),
    staleTime: 120_000,
  });
  const bench: Benchmark = React.useMemo(() => {
    if (!sales.data) return DEFAULT_BENCHMARK;
    const st = stores.rows.map((s) => {
      const rows = sales.data![s.id] ?? [];
      const days = new Set(rows.map((r) => String(r.createdAt).slice(0, 10))).size;
      return { areaSqFt: Number(s.areaSqFt) || 0, salesPaise: rows.reduce((a, r) => a + r.taxablePaise, 0), days, sales: rows.length };
    });
    const lines = Object.values(sales.data).flat().flatMap((r) => r.lines.map((l) => ({ dept: String(skuMap.get(l.skuId)?.departmentId ?? 'OTHER'), netPaise: l.taxablePaise, costPaise: l.unitCostPaise * l.qty })));
    return buildBenchmark(st, lines);
  }, [sales.data, stores.rows, skuMap]);
  return { bench, stores: stores.rows, sales: sales.data, loading: stores.loading || sales.isLoading };
}

/* ───────── India map (inline SVG, rough outline; lat/lng projected into a 300×320 box) */
const OUTLINE: [number, number][] = [[68.2, 23.7], [70, 24.2], [70.5, 25.5], [71, 27], [70, 28], [72, 29.5], [74, 31], [74.5, 32.5], [75.5, 33.5], [74.5, 34.5], [76.5, 35.8], [78.5, 35.5], [79.5, 33], [78.8, 32], [80, 30.5], [81, 30.2], [80.5, 28.8], [84, 27.3], [88, 26.5], [88.2, 27.8], [89.5, 28], [92, 27], [94.5, 28.5], [96.5, 28.2], [97.3, 27], [95.5, 25.5], [93.5, 24], [92.5, 22.5], [91.5, 24], [90, 25.2], [89, 26], [88.5, 24], [88, 22], [86.5, 20.5], [84.5, 19], [82, 16.5], [80.2, 15], [80.3, 13], [79.8, 10.5], [79.2, 9.2], [77.5, 8.1], [76.5, 9], [75.5, 11.5], [74.5, 14], [73.5, 16.5], [72.8, 19], [72.8, 21], [72.5, 22], [70.5, 20.8], [69, 22.3]];
const proj = (lat: number, lng: number) => ({ x: ((lng - 67) / 31) * 300, y: ((38 - lat) / 32) * 320 });
const OUTLINE_D = OUTLINE.map(([lng, lat], i) => { const p = proj(lat, lng); return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join('') + 'Z';

function IndiaMap({ stores, city }: { stores: { id: string; name?: unknown; lat?: unknown; lng?: unknown }[]; city: typeof CITIES[number] }) {
  const reduce = useReducedMotion();
  const pin = proj(city.lat, city.lng);
  return (
    <svg viewBox="0 0 300 320" role="img" aria-label={`India map: ${stores.length} existing stores and the proposed ${city.name} store`} className="mx-auto h-full max-h-[360px] w-full text-ink">
      <path d={OUTLINE_D} fill="#C7DDF5" fillOpacity={0.45} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1.5} strokeLinejoin="round" />
      {stores.filter((s) => s.lat && s.lng).map((s) => { const p = proj(Number(s.lat), Number(s.lng)); return <circle key={s.id} cx={p.x} cy={p.y} r={4} fill="#BFE6D6" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1}><title>{String(s.name ?? s.id)}</title></circle>; })}
      <motion.g key={city.name} initial={reduce ? false : { y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 15, delay: 0.15 }}>
        <ellipse cx={pin.x} cy={pin.y} rx={7} ry={2.5} fill="currentColor" opacity={0.18} />
        <path d={`M${pin.x} ${pin.y} c-9 -12 -9 -13 -9 -17 a9 9 0 1 1 18 0 c0 4 0 5 -9 17z`} fill="#E5486B" stroke="#fff" strokeWidth={1.2} />
        <circle cx={pin.x} cy={pin.y - 17} r={3.2} fill="#fff" />
      </motion.g>
      <text x={Math.min(pin.x + 12, 240)} y={pin.y - 22} fontSize={11} fill="currentColor" style={{ fontWeight: 600 }}>{city.name}</text>
    </svg>
  );
}

/* ───────── Area chart with confidence band (inline SVG; `d` tweens between scenarios) */
function SalesChart({ result, band }: { result: ProjectionResult; band: { month: number; lowPaise: number; highPaise: number }[] }) {
  const reduce = useReducedMotion();
  const W = 640, H = 260, L = 48, B = 26, T = 10, R = 8;
  const max = Math.max(...band.map((b) => b.highPaise), 1) * 1.08;
  const x = (m: number) => L + ((m - 1) / 23) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  const area = `${line(result.months.map((m) => m.salesPaise))}L${x(24)} ${y(0)}L${x(1)} ${y(0)}Z`;
  const bandD = `${line(band.map((b) => b.highPaise))}${band.slice().reverse().map((b) => `L${x(b.month).toFixed(1)} ${y(b.lowPaise).toFixed(1)}`).join('')}Z`;
  const be = result.breakEvenMonth;
  const t = reduce ? { duration: 0 } : { duration: 0.6, ease: 'easeOut' as const };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full text-ink" role="img" aria-label="Projected monthly sales for 24 months with confidence band">
      <defs>
        <linearGradient id="proj-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E5486B" stopOpacity={0.35} /><stop offset="100%" stopColor="#E5486B" stopOpacity={0.03} /></linearGradient>
        <clipPath id="proj-reveal"><motion.rect x={0} y={0} height={H} initial={{ width: reduce ? W : 0 }} animate={{ width: W }} transition={{ duration: reduce ? 0 : 1.1, ease: 'easeOut' }} /></clipPath>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" strokeOpacity={0.08} /><text x={L - 6} y={y(max * f) + 3} fontSize={9} textAnchor="end" fill="currentColor" opacity={0.55}>{inrC(Math.round(max * f))}</text></g>)}
      {[1, 6, 12, 18, 24].map((m) => <text key={m} x={x(m)} y={H - 8} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.55}>M{m}</text>)}
      <g clipPath="url(#proj-reveal)">
        <motion.path initial={false} animate={{ d: bandD }} transition={t} fill="#D9CCF2" fillOpacity={0.7} />
        <motion.path initial={false} animate={{ d: area }} transition={t} fill="url(#proj-area)" />
        <motion.path initial={false} animate={{ d: line(result.months.map((m) => m.salesPaise)) }} transition={t} fill="none" stroke="#E5486B" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      </g>
      {be && <g><line x1={x(be)} x2={x(be)} y1={T} y2={H - B} stroke="#2B2633" strokeOpacity={0.4} strokeDasharray="3 3" /><text x={x(be) + 4} y={T + 10} fontSize={10} fill="currentColor">Break-even M{be}</text></g>}
    </svg>
  );
}

/* ───────── Screen */
export function StoreProjections() {
  const { bench, stores, sales, loading } = useBenchmark();
  const [f, setF] = React.useState(DEFAULTS);
  const [scenario, setScenario] = React.useState<Scenario>('base');
  const city = CITIES.find((c) => c.name === f.city)!;
  const set = (k: keyof typeof DEFAULTS) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: k === 'city' ? e.target.value : Number(e.target.value) || 0 }));
  const input: ProjectionInput = { cityTier: city.tier, footfallPerDay: f.footfall, sizeSqFt: f.size, rentPerMonthPaise: Math.round(f.rent * 100), conversionPct: f.conv, atvPaise: Math.round(f.atv * 100) };
  const set3 = React.useMemo(() => projectScenarios(input, bench), [f.city, f.footfall, f.size, f.rent, f.conv, f.atv, bench]);
  const r = set3[scenario];
  const deptNames = useMaster('departments').map;
  const dept = (code: string) => String(deptNames.get(code)?.name ?? code);

  const outlook = React.useMemo(() => {
    const from = new Date().toISOString().slice(0, 10);
    return stores.map((s) => {
      const byDay = new Map<string, number>();
      for (const sale of sales?.[s.id] ?? []) { const d = String(sale.createdAt).slice(0, 10); byDay.set(d, (byDay.get(d) ?? 0) + sale.taxablePaise); }
      return { store: s, fc: forecastStoreSales([...byDay].map(([day, qty]) => ({ day, qty })), from, Number(s.areaSqFt) || 1200, bench) };
    });
  }, [stores, sales, bench]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHead title="Future store projections" sub="Model a new mall store: 24-month ramp, break-even, payback, opening stock and staffing." actions={<Badge tone={bench.source === 'seeded' ? 'mint' : 'butter'}>{bench.source === 'seeded' ? 'Benchmark: median seeded store' : 'Benchmark: illustrative defaults (seeded sales still sparse)'}</Badge>} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
        <Card className="flex flex-col gap-3 self-start">
          <h2 className="font-display text-lg">Inputs</h2>
          <Field label="City"><Select value={f.city} onChange={set('city')}>{CITIES.map((c) => <option key={c.name} value={c.name}>{c.name} · Tier {c.tier}</option>)}</Select></Field>
          <Field label="Mall footfall / day"><Input type="number" min={0} value={f.footfall} onChange={set('footfall')} /></Field>
          <Field label="Store size (sq ft)"><Input type="number" min={100} value={f.size} onChange={set('size')} /></Field>
          <Field label="Rent / month (₹)"><Input type="number" min={0} value={f.rent} onChange={set('rent')} /></Field>
          <Field label="Conversion (%)"><Input type="number" min={0} max={100} step={0.1} value={f.conv} onChange={set('conv')} /></Field>
          <Field label="Avg transaction value (₹)"><Input type="number" min={0} value={f.atv} onChange={set('atv')} /></Field>
          <p className="text-xs text-soft">Optimistic / conservative = ±15% on conversion and ATV.</p>
        </Card>
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={scenario} onChange={setScenario} items={SCENARIOS} />
            <span className="text-xs text-soft">Steady state ≈ {inrC(r.steadyMonthlySalesPaise)} / month · {inrC(r.salesPerSqFtMonthPaise)} per sq ft (median store {inrC(bench.salesPerSqFtMonthPaise)})</span>
          </div>
          {loading ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[116px]" />)}</div> : (
            <StaggerGrid className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Break-even" tone="mint" value={r.breakEvenMonth ?? 0} format={(n) => (r.breakEvenMonth ? `Month ${Math.round(n)}` : '—')} hint="First month EBITDA ≥ 0" />
              <Kpi label="Payback" tone="butter" value={r.paybackMonth ?? 0} format={(n) => (r.paybackMonth ? `${Math.round(n)} months` : '> 60 months')} hint={`on ${inrC(r.investmentPaise)} invested`} />
              <Kpi label="Gross margin" tone="blush" value={r.grossMarginPct} format={(n) => `${n.toFixed(1)}%`} hint={`Steady opex ${inrC(r.steadyOpexPaise)}/mo`} />
              <Kpi label="Staff" tone="sky" value={r.staffCount} hint="Steady-state headcount" />
            </StaggerGrid>
          )}
          <Card>
            <div className="mb-2 flex items-baseline justify-between"><h2 className="font-display text-lg">Monthly sales ramp</h2><span className="text-xs text-soft">Line = {scenario}; band = conservative → optimistic</span></div>
            <SalesChart result={r} band={set3.band} />
          </Card>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Card>
              <h2 className="font-display text-lg">Opening stock</h2>
              <p className="mb-3 text-xs text-soft">{inrC(r.openingStockPaise)} at cost (2.5 months of cover), split by the seeded sales mix.</p>
              <ul className="flex flex-col gap-2">
                {r.openingStock.map((s) => (
                  <li key={s.dept} className="text-sm">
                    <div className="flex justify-between"><span>{dept(s.dept)}</span><span className="tabular-nums text-soft">{inrC(s.valuePaise)} · {s.sharePct}%</span></div>
                    <div className="mt-1 h-2 overflow-hidden rounded-pill bg-ink/5"><motion.div className="h-full rounded-pill bg-blush" initial={{ width: 0 }} animate={{ width: `${s.sharePct}%` }} transition={{ duration: 0.6 }} /></div>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="flex flex-col">
              <h2 className="font-display text-lg">Where it sits</h2>
              <div className="min-h-0 flex-1"><IndiaMap stores={stores} city={city} /></div>
              <p className="text-center text-xs text-soft"><span className="text-mint">●</span> {stores.length} existing stores · <span className="text-cherry">●</span> proposed {city.name}</p>
            </Card>
          </div>
        </div>
      </div>
      <section aria-label="Existing store outlook" className="flex flex-col gap-3">
        <h2 className="font-display text-xl">Existing stores — 3 / 6 / 12-month outlook</h2>
        {loading ? <Skeleton className="h-40" /> : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {outlook.map(({ store, fc }) => (
              <Card key={store.id} className="flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2"><b className="text-sm">{String(store.name)}</b><Badge tone={fc.basis === 'history' ? 'mint' : 'lavender'}>{fc.basis === 'history' ? 'forecast.ts' : 'benchmark'}</Badge></div>
                <p className="text-xs text-soft">Run-rate {inrC(fc.runRateMonthlyPaise)}/mo · trend {fc.trendPctPerMonth >= 0 ? '+' : ''}{fc.trendPctPerMonth}%/mo</p>
                <div className="grid grid-cols-3 gap-2">
                  {fc.cards.map((c) => (
                    <div key={c.horizonMonths} className="rounded-2xl bg-sky/30 p-2 text-center">
                      <div className="text-[11px] text-soft">{c.horizonMonths}M</div>
                      <CountUp value={c.salesPaise} format={(n) => inrC(Math.round(n))} className="text-sm font-semibold" />
                      <div className="text-[11px] text-soft">{c.deltaPct >= 0 ? '+' : ''}{c.deltaPct}%</div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
