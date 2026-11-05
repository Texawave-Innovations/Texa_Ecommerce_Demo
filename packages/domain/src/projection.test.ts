import { describe, expect, it } from 'vitest';
import { DEFAULT_BENCHMARK, PROJECTION_MONTHS, buildBenchmark, forecastStoreSales, projectScenarios, projectStore, rampFactor, type ProjectionInput } from './projection';

const input: ProjectionInput = { cityTier: 1, footfallPerDay: 1200, sizeSqFt: 1300, rentPerMonthPaise: 3_50_000_00, conversionPct: 5, atvPaise: 1100_00 };

describe('rampFactor', () => {
  it('rises monotonically from ~0.3 to ~1', () => {
    expect(rampFactor(1)).toBeGreaterThan(0.29); expect(rampFactor(1)).toBeLessThan(0.4);
    expect(rampFactor(24)).toBeGreaterThan(0.99);
    for (let m = 2; m <= 24; m++) expect(rampFactor(m)).toBeGreaterThan(rampFactor(m - 1));
  });
});

describe('projectStore', () => {
  const base = projectStore(input, DEFAULT_BENCHMARK);
  it('returns 24 months with integer paise and steady-state sales = footfall × conversion × ATV × 30', () => {
    expect(base.months).toHaveLength(PROJECTION_MONTHS);
    expect(base.steadyMonthlySalesPaise).toBe(Math.round(1200 * 30 * 0.05 * 1100_00));
    expect(base.months.every((m) => Number.isInteger(m.salesPaise) && Number.isInteger(m.ebitdaPaise))).toBe(true);
  });
  it('finds break-even before payback, and cumulative cash starts negative', () => {
    expect(base.breakEvenMonth).not.toBeNull();
    expect(base.paybackMonth).not.toBeNull();
    expect(base.paybackMonth!).toBeGreaterThan(base.breakEvenMonth!);
    expect(base.months[0]!.cumulativeCashPaise).toBeLessThan(0);
  });
  it('splits opening stock exactly by the department mix', () => {
    expect(base.openingStock.reduce((a, s) => a + s.valuePaise, 0)).toBe(base.openingStockPaise);
    expect(base.openingStock).toHaveLength(DEFAULT_BENCHMARK.deptMix.length);
  });
  it('reports no break-even when rent swamps gross profit', () => {
    const r = projectStore({ ...input, rentPerMonthPaise: 50_00_000_00 }, DEFAULT_BENCHMARK);
    expect(r.breakEvenMonth).toBeNull(); expect(r.paybackMonth).toBeNull();
  });
  it('smaller cities sell less and need fewer/cheaper staff', () => {
    expect(projectStore({ ...input, cityTier: 3 }, DEFAULT_BENCHMARK).steadyMonthlySalesPaise).toBeLessThan(base.steadyMonthlySalesPaise);
  });
});

describe('projectScenarios', () => {
  const s = projectScenarios(input, DEFAULT_BENCHMARK);
  it('applies ±15% to conversion and ATV and orders the scenarios', () => {
    expect(s.optimistic.steadyMonthlySalesPaise).toBe(Math.round(1200 * 30 * 0.05 * 1.15 * 1100_00 * 1.15));
    expect(s.conservative.steadyMonthlySalesPaise).toBeLessThan(s.base.steadyMonthlySalesPaise);
    expect(s.optimistic.paybackMonth!).toBeLessThan(s.conservative.paybackMonth ?? 999);
  });
  it('band envelopes the base case every month', () => {
    s.band.forEach((b, i) => { expect(b.lowPaise).toBeLessThanOrEqual(s.base.months[i]!.salesPaise); expect(b.highPaise).toBeGreaterThanOrEqual(s.base.months[i]!.salesPaise); });
  });
});

describe('buildBenchmark', () => {
  it('falls back to defaults while seeded history is sparse', () => {
    const b = buildBenchmark([{ areaSqFt: 1300, salesPaise: 5_000_00, days: 1, sales: 3 }], []);
    expect(b.source).toBe('default'); expect(b.salesPerSqFtMonthPaise).toBe(DEFAULT_BENCHMARK.salesPerSqFtMonthPaise);
  });
  it('uses the median store and sale-line mix once there is enough history', () => {
    const stores = [1000, 2000, 3000].map((a) => ({ areaSqFt: a, salesPaise: a * 1000_00, days: 30, sales: 400 }));
    const lines = Array.from({ length: 30 }, (_, i) => ({ dept: i % 3 ? 'BAG' : 'PLU', netPaise: 1000_00, costPaise: 400_00 }));
    const b = buildBenchmark(stores, lines);
    expect(b.source).toBe('seeded'); expect(b.salesPerSqFtMonthPaise).toBe(1000_00);
    expect(b.grossMarginPct).toBe(60); expect(b.deptMix[0]!.dept).toBe('BAG');
  });
});

describe('forecastStoreSales', () => {
  it('uses the benchmark when history is under a week', () => {
    const f = forecastStoreSales([{ day: '2026-11-04', qty: 5000 }], '2026-11-05', 1000, DEFAULT_BENCHMARK);
    expect(f.basis).toBe('benchmark'); expect(f.runRateMonthlyPaise).toBe(1000 * DEFAULT_BENCHMARK.salesPerSqFtMonthPaise);
    expect(f.cards.map((c) => c.horizonMonths)).toEqual([3, 6, 12]);
  });
  it('extrapolates a growing history with a clamped positive trend', () => {
    const hist = Array.from({ length: 28 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, qty: 10_000_00 + i * 50_000 }));
    const f = forecastStoreSales(hist, '2026-11-01', 1000, DEFAULT_BENCHMARK);
    expect(f.basis).toBe('history'); expect(f.trendPctPerMonth).toBeGreaterThan(0); expect(f.trendPctPerMonth).toBeLessThanOrEqual(3);
    expect(f.cards[2]!.salesPaise).toBeGreaterThan(f.cards[0]!.salesPaise);
  });
});
