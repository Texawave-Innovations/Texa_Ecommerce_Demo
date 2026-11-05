import { describe, expect, it } from 'vitest';
import { evaluateAlerts, type AlertSnapshot } from './alerts';
import { daysOfCover, forecastByWeekday, forecastMarkdown, forecastReplenishment, weekdayOf } from './forecast';

const empty: AlertSnapshot = { day: '2026-11-05', hourIst: 15, stockCover: [], overduePOs: [], varianceGrns: [], zReports: [], voidStats: [], voucherUse: [], failedTally: [], salesToday: [] };
const run = (p: Partial<AlertSnapshot>) => evaluateAlerts({ ...empty, ...p });

describe('alert rules', () => {
  it('flags stock-out risk only below 3 days of cover; zero stock is critical', () => {
    const r = run({ stockCover: [
      { skuId: 'a', skuName: 'A', locationId: 'BLR-FS', onHand: 4, daysOfCover: 2.5 },
      { skuId: 'b', skuName: 'B', locationId: 'BLR-FS', onHand: 0, daysOfCover: 0 },
      { skuId: 'c', skuName: 'C', locationId: 'BLR-FS', onHand: 40, daysOfCover: 3 },
    ] });
    expect(r.map((x) => [x.ruleId, x.severity])).toEqual([['stock_out_risk', 'warning'], ['stock_out_risk', 'critical']]);
  });

  it('cash variance respects tolerance and escalates at ₹500', () => {
    const r = run({ zReports: [
      { shiftId: 's1', storeId: 'X', shiftNo: 1, cashierName: 'A', variancePaise: -20_00 },
      { shiftId: 's2', storeId: 'X', shiftNo: 2, cashierName: 'B', variancePaise: -120_00 },
      { shiftId: 's3', storeId: 'X', shiftNo: 3, cashierName: 'C', variancePaise: 900_00 },
    ] });
    expect(r.map((x) => x.severity)).toEqual(['warning', 'critical']);
  });

  it('void spike needs > 3× baseline and at least 2 voids', () => {
    expect(run({ voidStats: [{ storeId: 'X', todayVoids: 1, todayBills: 5, baselineRate: 0.01 }] })).toHaveLength(0);
    expect(run({ voidStats: [{ storeId: 'X', todayVoids: 3, todayBills: 30, baselineRate: 0.03 }] })).toHaveLength(1);   // 10% vs 3%
    expect(run({ voidStats: [{ storeId: 'X', todayVoids: 3, todayBills: 30, baselineRate: 0.05 }] })).toHaveLength(0);   // 10% < 15%
  });

  it('voucher abuse is strictly more than 5 per till', () => {
    expect(run({ voucherUse: [{ storeId: 'X', tillId: 'T1', count: 5 }] })).toHaveLength(0);
    expect(run({ voucherUse: [{ storeId: 'X', tillId: 'T1', count: 6 }] })).toHaveLength(1);
  });

  it('sales-behind-target only fires from 2 pm and under 40%', () => {
    const row = { storeId: 'X', storeName: 'X', salesPaise: 30_000_00, targetPaise: 100_000_00 };
    expect(run({ hourIst: 13, salesToday: [row] })).toHaveLength(0);
    expect(run({ hourIst: 14, salesToday: [row] })).toHaveLength(1);
    expect(run({ hourIst: 14, salesToday: [{ ...row, salesPaise: 45_000_00 }] })).toHaveLength(0);
  });

  it('PO overdue, GRN variance and Tally failure map one-to-one with stable keys', () => {
    const r = run({
      overduePOs: [{ id: 'p1', number: 'PO/1', vendorName: 'V', expectedDate: '2026-10-20', daysLate: 16 }],
      varianceGrns: [{ id: 'g1', number: 'GRN/1', poNumber: 'PO/1', locationId: 'WH-CENTRAL', short: 2, excess: 0, damaged: 1 }],
      failedTally: [{ id: 't1', storeId: 'X', day: '2026-11-04', attempts: 3, error: 'timeout' }],
    });
    expect(r.map((x) => x.ruleId)).toEqual(['po_overdue', 'grn_variance', 'tally_sync_failed']);
    expect(r[0]!.severity).toBe('critical');
    expect(new Set(r.map((x) => x.dedupeKey)).size).toBe(3);
  });
});

describe('forecast', () => {
  // 4 weeks of history ending 2026-11-04 (Wed); Saturdays sell 10, other days 2.
  const history = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 8 + i)).toISOString().slice(0, 10);
    return { day: d, qty: weekdayOf(d) === 6 ? 10 : 2 };
  });
  const f = forecastByWeekday(history, '2026-11-05', 7);

  it('uses the weekday pattern (Saturday peaks)', () => {
    expect(f).toHaveLength(7);
    const sat = f.find((p) => weekdayOf(p.day) === 6)!;
    expect(sat.qty).toBe(10);
    expect(f.find((p) => weekdayOf(p.day) === 1)!.qty).toBe(2);
  });

  it('returns zeros with no history and computes days of cover through the horizon', () => {
    expect(forecastByWeekday([], '2026-11-05', 3).every((p) => p.qty === 0)).toBe(true);
    expect(daysOfCover(0, f)).toBe(0);
    expect(daysOfCover(3, f)).toBeGreaterThan(1);
    expect(daysOfCover(5, [{ day: 'a', qty: 0 }])).toBe(999);
  });

  it('suggests replenishment net of stock on order and markdown for slow movers', () => {
    const flat = forecastByWeekday(history, '2026-11-05', 28);
    const none = forecastReplenishment({ onHand: 100, forecast: flat, leadTimeDays: 4 });
    expect(none.suggestQty).toBe(0);
    const low = forecastReplenishment({ onHand: 2, onOrder: 0, forecast: flat, leadTimeDays: 4 });
    expect(low.suggestQty).toBeGreaterThan(10);
    expect(forecastReplenishment({ onHand: 2, onOrder: 500, forecast: flat, leadTimeDays: 4 }).suggestQty).toBe(0);
    expect(forecastMarkdown({ onHand: 5, forecast: flat })).toBeNull();
    expect(forecastMarkdown({ onHand: 200, forecast: flat })?.markdownPct).toBe(10);
    expect(forecastMarkdown({ onHand: 500, forecast: flat })?.markdownPct).toBe(30);
  });
});
