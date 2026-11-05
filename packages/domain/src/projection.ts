/** Future-store projections: 24-month logistic sales ramp, P&L, break-even/payback, opening stock and staffing. Pure TS; money = integer paise. */
import { forecastByWeekday, totalForecast, type DailyQty } from './forecast';

export type Scenario = 'optimistic' | 'base' | 'conservative';
export const SCENARIO_DELTA: Record<Scenario, number> = { optimistic: 0.15, base: 0, conservative: -0.15 };
export const PROJECTION_MONTHS = 24;
const HORIZON = 60;          // payback may land beyond month 24, so the model runs 60 months and returns the first 24
const RAMP_FLOOR = 0.3;      // month-1 share of steady-state sales
const RAMP_K = 0.45, RAMP_MID = 8;
/** Footfall→sales haircut for smaller cities (rent/mix fixed by input, this captures lower spend density). */
const TIER_SALES: Record<1 | 2 | 3, number> = { 1: 1, 2: 0.92, 3: 0.85 };
const TIER_WAGE: Record<1 | 2 | 3, number> = { 1: 1, 2: 0.9, 3: 0.8 };
const FITOUT_PER_SQFT_PAISE = 3_500_00;
const AVG_WAGE_PAISE = 22_000_00;
const VARIABLE_OPEX_PCT = 0.07;      // utilities, CAM, packaging, marketing, card fees
const FIXED_OPEX_PAISE = 40_000_00;  // insurance, software, housekeeping
const STOCK_COVER_MONTHS = 2.5;

export interface ProjectionInput {
  cityTier: 1 | 2 | 3;
  footfallPerDay: number;
  sizeSqFt: number;
  rentPerMonthPaise: number;
  conversionPct: number;
  atvPaise: number;
}
export interface DeptShare { dept: string; share: number }
export interface Benchmark {
  /** Median seeded store, steady state. */
  salesPerSqFtMonthPaise: number;
  grossMarginPct: number;
  deptMix: DeptShare[];
  source: 'seeded' | 'default';
}
export const DEFAULT_BENCHMARK: Benchmark = {
  salesPerSqFtMonthPaise: 1_400_00, grossMarginPct: 52, source: 'default',
  deptMix: [{ dept: 'KLV', share: 0.26 }, { dept: 'BAG', share: 0.18 }, { dept: 'PLU', share: 0.2 }, { dept: 'LIF', share: 0.14 }, { dept: 'STA', share: 0.12 }, { dept: 'CAR', share: 0.1 }],
};

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

export interface BenchmarkStore { areaSqFt: number; salesPaise: number; days: number; sales: number }
export interface BenchmarkLine { dept: string; netPaise: number; costPaise: number }
/**
 * Median seeded store → benchmark. Seeded sales history is sparse (a few bills over a day or two), so sales-per-sq-ft only
 * switches from the default once the median store has ≥ 14 trading days and ≥ 30 bills; margin and dept mix come from sale lines when there are ≥ 20.
 */
export function buildBenchmark(stores: BenchmarkStore[], lines: BenchmarkLine[]): Benchmark {
  const usable = stores.filter((s) => s.areaSqFt > 0 && s.days >= 14 && s.sales >= 30);
  const psf = usable.length ? Math.round(median(usable.map((s) => (s.salesPaise / s.days) * 30 / s.areaSqFt))) : 0;
  const net = lines.reduce((a, l) => a + l.netPaise, 0), cost = lines.reduce((a, l) => a + l.costPaise, 0);
  const haveLines = lines.length >= 20 && net > 0;
  const byDept = new Map<string, number>();
  for (const l of lines) byDept.set(l.dept, (byDept.get(l.dept) ?? 0) + l.netPaise);
  const deptMix = haveLines ? [...byDept].map(([dept, v]) => ({ dept, share: v / net })).sort((a, b) => b.share - a.share) : DEFAULT_BENCHMARK.deptMix;
  const margin = haveLines ? Math.round((1 - cost / net) * 1000) / 10 : DEFAULT_BENCHMARK.grossMarginPct;
  return {
    salesPerSqFtMonthPaise: psf || DEFAULT_BENCHMARK.salesPerSqFtMonthPaise,
    grossMarginPct: margin > 5 && margin < 90 ? margin : DEFAULT_BENCHMARK.grossMarginPct,
    deptMix,
    source: psf || haveLines ? 'seeded' : 'default',
  };
}

/** Logistic ramp, 0.3 in month 1 → ~1.0 by month ~18 (month is 1-based). */
export const rampFactor = (month: number) => RAMP_FLOOR + (1 - RAMP_FLOOR) * (1 / (1 + Math.exp(-RAMP_K * (month - RAMP_MID))));

export interface ProjectionMonth { month: number; salesPaise: number; grossProfitPaise: number; opexPaise: number; ebitdaPaise: number; cumulativeCashPaise: number }
export interface StockLine { dept: string; sharePct: number; valuePaise: number }
export interface ProjectionResult {
  scenario: Scenario;
  months: ProjectionMonth[];           // first 24
  steadyMonthlySalesPaise: number;
  salesPerSqFtMonthPaise: number;
  grossMarginPct: number;
  steadyOpexPaise: number;
  staffCount: number;
  capexPaise: number;                  // fit-out + 6 months' rent deposit
  openingStockPaise: number;           // at cost
  investmentPaise: number;             // capex + opening stock
  openingStock: StockLine[];
  breakEvenMonth: number | null;       // first month with EBITDA ≥ 0
  paybackMonth: number | null;         // cumulative EBITDA ≥ investment (null = beyond 60 months)
}

export function staffFor(input: ProjectionInput, steadyMonthlySalesPaise: number): number {
  const byArea = Math.ceil(input.sizeSqFt / 180) + 2;
  const byRevenue = Math.ceil(steadyMonthlySalesPaise / 100 / 30 / 18_000);  // ~₹18k of daily sales per head
  return Math.max(3, Math.round((byArea + byRevenue) / 2));
}

export function projectStore(input: ProjectionInput, bench: Benchmark, scenario: Scenario = 'base'): ProjectionResult {
  const d = SCENARIO_DELTA[scenario];
  const conv = (input.conversionPct / 100) * (1 + d), atv = input.atvPaise * (1 + d);
  const steady = Math.round(input.footfallPerDay * 30 * conv * atv * TIER_SALES[input.cityTier]);
  const gm = bench.grossMarginPct / 100;
  const staff = staffFor(input, steady);
  const wages = Math.round(staff * AVG_WAGE_PAISE * TIER_WAGE[input.cityTier]);
  const capex = Math.round(input.sizeSqFt * FITOUT_PER_SQFT_PAISE + 6 * input.rentPerMonthPaise);
  const stock = Math.round(steady * (1 - gm) * STOCK_COVER_MONTHS);
  const investment = capex + stock;
  const months: ProjectionMonth[] = [];
  let cum = -investment, breakEven: number | null = null, payback: number | null = null;
  for (let m = 1; m <= HORIZON; m++) {
    const sales = Math.round(steady * rampFactor(m));
    const gp = Math.round(sales * gm);
    const opex = Math.round(input.rentPerMonthPaise + wages + FIXED_OPEX_PAISE + sales * VARIABLE_OPEX_PCT);
    const ebitda = gp - opex;
    cum += ebitda;
    if (breakEven === null && ebitda >= 0) breakEven = m;
    if (payback === null && cum >= 0) payback = m;
    if (m <= PROJECTION_MONTHS) months.push({ month: m, salesPaise: sales, grossProfitPaise: gp, opexPaise: opex, ebitdaPaise: ebitda, cumulativeCashPaise: cum });
  }
  const mixTotal = bench.deptMix.reduce((a, x) => a + x.share, 0) || 1;
  let left = stock;
  const openingStock = bench.deptMix.map((x, i, arr) => {
    const v = i === arr.length - 1 ? left : Math.round(stock * (x.share / mixTotal));
    left -= v; return { dept: x.dept, sharePct: Math.round((x.share / mixTotal) * 1000) / 10, valuePaise: v };
  });
  return {
    scenario, months, steadyMonthlySalesPaise: steady, salesPerSqFtMonthPaise: Math.round(steady / Math.max(1, input.sizeSqFt)),
    grossMarginPct: bench.grossMarginPct, steadyOpexPaise: Math.round(input.rentPerMonthPaise + wages + FIXED_OPEX_PAISE + steady * VARIABLE_OPEX_PCT),
    staffCount: staff, capexPaise: capex, openingStockPaise: stock, investmentPaise: investment, openingStock, breakEvenMonth: breakEven, paybackMonth: payback,
  };
}

export interface ProjectionSet { base: ProjectionResult; optimistic: ProjectionResult; conservative: ProjectionResult; band: { month: number; lowPaise: number; highPaise: number }[] }
export function projectScenarios(input: ProjectionInput, bench: Benchmark): ProjectionSet {
  const base = projectStore(input, bench, 'base'), optimistic = projectStore(input, bench, 'optimistic'), conservative = projectStore(input, bench, 'conservative');
  return { base, optimistic, conservative, band: base.months.map((m, i) => ({ month: m.month, lowPaise: conservative.months[i]!.salesPaise, highPaise: optimistic.months[i]!.salesPaise })) };
}

export interface StoreForecast { horizonMonths: 3 | 6 | 12; salesPaise: number; deltaPct: number }
export interface StoreForecastResult { runRateMonthlyPaise: number; trendPctPerMonth: number; basis: 'history' | 'benchmark'; cards: StoreForecast[] }
/**
 * 3/6/12-month sales outlook for an existing store. Run-rate = `forecastByWeekday` (revenue as the "qty") over the next 28 days scaled to 30;
 * trend = growth between the two halves of history, clamped to ±3%/month. With < 7 days of history there is nothing to extrapolate, so it
 * falls back to benchmark sales/sq ft × store area, flat trend.
 */
export function forecastStoreSales(daily: DailyQty[], from: string, areaSqFt: number, bench: Benchmark): StoreForecastResult {
  const days = [...new Set(daily.map((d) => d.day))].sort();
  const enough = days.length >= 7;
  const run = enough ? Math.round((totalForecast(forecastByWeekday(daily, from, 28)) / 28) * 30) : Math.round(areaSqFt * bench.salesPerSqFtMonthPaise);
  let trend = 0;
  if (enough) {
    const mid = days[Math.floor(days.length / 2)]!;
    const a = daily.filter((d) => d.day < mid).reduce((s, d) => s + d.qty, 0), b = daily.filter((d) => d.day >= mid).reduce((s, d) => s + d.qty, 0);
    const na = days.filter((d) => d < mid).length || 1, nb = days.filter((d) => d >= mid).length || 1;
    const g = a > 0 ? (b / nb) / (a / na) - 1 : 0;
    const spanMonths = Math.max(0.25, (days.length / 2) / 30);
    trend = Math.max(-0.03, Math.min(0.03, g / spanMonths));
  }
  const cards = ([3, 6, 12] as const).map((h) => {
    const sales = Math.round(run * Math.pow(1 + trend, h) * h);
    return { horizonMonths: h, salesPaise: sales, deltaPct: Math.round((Math.pow(1 + trend, h) - 1) * 1000) / 10 };
  });
  return { runRateMonthlyPaise: run, trendPctPerMonth: Math.round(trend * 1000) / 10, basis: enough ? 'history' : 'benchmark', cards };
}
