import { describe, expect, it } from 'vitest';
import {
  abcClasses, ageing, apportion, dueDate, ewayRequired, fifoValue, importDuty, landedCost, mayApprove, routeApproval, scoreQuotes,
  splitGst, suggestBin, suggestReplenishment, threeWayMatch, toInrPaise, wacAfterReceipt, tdsAmount, DEFAULT_TOLERANCE,
} from './index';

describe('landed cost', () => {
  it('apportions exactly (largest remainder) and never loses a paisa', () => {
    const parts = apportion(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts.sort()).toEqual([333, 333, 334]);
  });
  it('by value', () => {
    const r = landedCost([{ key: 'A', qty: 10, valuePaise: 60000 }, { key: 'B', qty: 10, valuePaise: 40000 }], [{ type: 'freight', amountPaise: 10000 }], 'value');
    expect(r.lines.map((l) => l.allocatedPaise)).toEqual([6000, 4000]);
    expect(r.lines[0]).toMatchObject({ addPerUnitPaise: 600, landedUnitCostPaise: 6600 });
  });
  it('by qty and by weight', () => {
    const lines = [{ key: 'A', qty: 1, valuePaise: 100, weightGrams: 100 }, { key: 'B', qty: 3, valuePaise: 100, weightGrams: 100 }];
    expect(landedCost(lines, [{ type: 'x', amountPaise: 400 }], 'qty').lines.map((l) => l.allocatedPaise)).toEqual([100, 300]);
    expect(landedCost(lines, [{ type: 'x', amountPaise: 400 }], 'weight').lines.map((l) => l.allocatedPaise)).toEqual([100, 300]);
    expect(() => landedCost([{ key: 'A', qty: 1, valuePaise: 1 }], [{ type: 'x', amountPaise: 1 }], 'weight')).toThrow();
  });
});

describe('import duty', () => {
  it('BCD, SWS 10% of BCD, IGST on AV+BCD+SWS; IGST is credit not cost', () => {
    const d = importDuty({ assessableValuePaise: 1_000_000, bcdPct: 20, igstPct: 18 });
    expect(d).toMatchObject({ bcdPaise: 200_000, swsPaise: 20_000, igstBasePaise: 1_220_000, igstPaise: 219_600, landedAddPaise: 220_000 });
  });
});

describe('3-way match', () => {
  const po = [{ skuId: 'S1', orderedQty: 100, unitPriceMinor: 5000 }, { skuId: 'S2', orderedQty: 50, unitPriceMinor: 2000 }];
  const grn = [{ skuId: 'S1', acceptedQty: 90 }, { skuId: 'S2', acceptedQty: 50 }];
  it('matches within tolerance', () => {
    const r = threeWayMatch(po, grn, [{ skuId: 'S1', qty: 90, unitPriceMinor: 5050 }, { skuId: 'S2', qty: 50, unitPriceMinor: 2000 }]);
    expect(r.status).toBe('matched');
  });
  it('holds when billing more than accepted', () => {
    const r = threeWayMatch(po, grn, [{ skuId: 'S1', qty: 100, unitPriceMinor: 5000 }]);
    expect(r.status).toBe('hold');
    expect(r.lines[0]!.issues).toContain('over_billed_qty');
  });
  it('holds on price above tolerance, passes below the PO price', () => {
    expect(threeWayMatch(po, grn, [{ skuId: 'S1', qty: 10, unitPriceMinor: 5200 }]).status).toBe('hold');
    expect(threeWayMatch(po, grn, [{ skuId: 'S1', qty: 10, unitPriceMinor: 4000 }]).status).toBe('matched');
  });
  it('accounts for quantity already billed', () => {
    const r = threeWayMatch(po, grn, [{ skuId: 'S1', qty: 50, unitPriceMinor: 5000 }], { S1: 60 });
    expect(r.lines[0]!.issues).toContain('over_billed_qty');
  });
  it('holds for SKU not on PO and when nothing received', () => {
    expect(threeWayMatch(po, grn, [{ skuId: 'X', qty: 1, unitPriceMinor: 1 }]).lines[0]!.issues).toContain('not_on_po');
    expect(threeWayMatch(po, [], [{ skuId: 'S1', qty: 1, unitPriceMinor: 5000 }]).lines[0]!.issues).toContain('no_grn');
  });
  it('tolerance is configurable', () => {
    const r = threeWayMatch(po, grn, [{ skuId: 'S1', qty: 92, unitPriceMinor: 5000 }], {}, { ...DEFAULT_TOLERANCE, qtyUnits: 2 });
    expect(r.status).toBe('matched');
  });
});

describe('valuation', () => {
  it('WAC', () => { expect(wacAfterReceipt(10, 1000, 10, 2000)).toBe(1500); expect(wacAfterReceipt(0, 0, 5, 800)).toBe(800); });
  it('FIFO values on-hand from the newest layers and ages them', () => {
    const now = Date.UTC(2026, 10, 1);
    const day = 86_400_000;
    const layers = [{ qty: 10, unitCostPaise: 100, atMs: now - 100 * day }, { qty: 10, unitCostPaise: 200, atMs: now - 40 * day }, { qty: 10, unitCostPaise: 300, atMs: now - 5 * day }];
    const f = fifoValue(layers, 15); // oldest 15 sold → remaining = 10@300 + 5@200
    expect(f.valuePaise).toBe(10 * 300 + 5 * 200);
    const a = ageing(f.used, now);
    expect(a['0-30'].qty).toBe(10); expect(a['31-60'].qty).toBe(5); expect(a['90+'].qty).toBe(0);
  });
  it('ABC classes', () => {
    const c = abcClasses([{ key: 'a', valuePaise: 700 }, { key: 'b', valuePaise: 200 }, { key: 'c', valuePaise: 100 }]);
    expect(c).toEqual({ a: 'A', b: 'B', c: 'C' });
  });
});

describe('payables', () => {
  it('MSME due date capped at 45 days; non-MSME uses terms', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(dueDate(d, 60, true).toISOString().slice(0, 10)).toBe('2026-02-15');
    expect(dueDate(d, 60, false).toISOString().slice(0, 10)).toBe('2026-03-02');
  });
  it('TDS and FX', () => { expect(tdsAmount(1_000_000, 2)).toBe(20_000); expect(toInrPaise(100_000, 6.1)).toBe(6100); });
});

describe('gst & e-way', () => {
  it('intra → CGST+SGST (odd paise to SGST), inter → IGST', () => {
    expect(splitGst(10003, 18, true)).toMatchObject({ cgstPaise: 900, sgstPaise: 901, igstPaise: 0 });
    expect(splitGst(10000, 18, false)).toMatchObject({ igstPaise: 1800, cgstPaise: 0 });
  });
  it('e-way above ₹50,000 only', () => { expect(ewayRequired(5_000_000)).toBe(false); expect(ewayRequired(5_000_001)).toBe(true); });
});

describe('replenishment', () => {
  const base = { leadTimeDays: 10, date: new Date('2026-05-10T00:00:00Z') };
  it('suggests an order when position is at/below reorder point', () => {
    const r = suggestReplenishment({ ...base, dailyDemand: 2, onHand: 5, onOrder: 0, inTransit: 0 });
    expect(r.suggestQty).toBeGreaterThan(0);
    expect(r.position + r.suggestQty).toBeGreaterThanOrEqual(r.targetStock);
  });
  it('does not order when stock is ample, and counts open POs / in-transit', () => {
    expect(suggestReplenishment({ ...base, dailyDemand: 1, onHand: 200, onOrder: 0, inTransit: 0 }).suggestQty).toBe(0);
    const open = suggestReplenishment({ ...base, dailyDemand: 2, onHand: 5, onOrder: 100, inTransit: 0 });
    expect(open.suggestQty).toBe(0);
  });
  it('festive season raises the target; min/max honoured', () => {
    const normal = suggestReplenishment({ ...base, dailyDemand: 2, onHand: 0, onOrder: 0, inTransit: 0 });
    const festive = suggestReplenishment({ ...base, date: new Date('2026-11-01T00:00:00Z'), dailyDemand: 2, onHand: 0, onOrder: 0, inTransit: 0 });
    expect(festive.targetStock).toBeGreaterThan(normal.targetStock);
    expect(suggestReplenishment({ ...base, dailyDemand: 0, onHand: 2, onOrder: 0, inTransit: 0, min: 4, max: 20 })).toMatchObject({ suggestQty: 18, urgency: 'normal' });
  });
});

describe('approval routing', () => {
  const matrix = [{ docType: 'PO', minPaise: 0, maxPaise: 50_000_000, approverRole: 'cfo' }, { docType: 'PO', minPaise: 50_000_001, maxPaise: 9e12, approverRole: 'super_admin' }];
  it('auto-approves only when maker holds the role and limit', () => {
    expect(routeApproval('PO', 1_000_000, matrix, { role: 'cfo', approvalLimitPaise: 5_000_000_00 })).toMatchObject({ autoApprove: true, approverRole: 'cfo' });
    expect(routeApproval('PO', 1_000_000, matrix, { role: 'buyer', approvalLimitPaise: 5_000_000_00 }).autoApprove).toBe(false);
    expect(routeApproval('PO', 60_000_000, matrix, { role: 'cfo', approvalLimitPaise: 5_000_000_00 })).toMatchObject({ autoApprove: false, approverRole: 'super_admin' });
  });
  it('maker-checker, role and limit enforced on approval', () => {
    expect(mayApprove({ uid: 'a', role: 'cfo', approvalLimitPaise: 100 }, 'a', 'cfo', 50)).toMatch(/own/);
    expect(mayApprove({ uid: 'b', role: 'buyer', approvalLimitPaise: 100 }, 'a', 'cfo', 50)).toMatch(/role/);
    expect(mayApprove({ uid: 'b', role: 'cfo', approvalLimitPaise: 10 }, 'a', 'cfo', 50)).toMatch(/limit/);
    expect(mayApprove({ uid: 'b', role: 'cfo', approvalLimitPaise: 100 }, 'a', 'cfo', 50)).toBeNull();
  });
});

describe('vendor score & bins', () => {
  it('ranks cheap+reliable first', () => {
    const r = scoreQuotes([
      { vendorId: 'A', totalInrPaise: 100_000, leadTimeDays: 30, stats: { onTimePct: 95, fillRatePct: 98, defectPct: 1 } },
      { vendorId: 'B', totalInrPaise: 90_000, leadTimeDays: 45, stats: { onTimePct: 60, fillRatePct: 70, defectPct: 9 } },
    ]);
    expect(r[0]!.vendorId).toBe('A'); expect(r[0]!.rank).toBe(1);
  });
  it('bin suggestion prefers department bin with room and skips QC/damaged cages', () => {
    const bins = [{ id: 'BIN-QC-01', capacityUnits: 999, used: 0 }, { id: 'BIN-PLU-01', capacityUnits: 100, departmentId: 'PLU', used: 95 }, { id: 'BIN-PLU-02', capacityUnits: 100, departmentId: 'PLU', used: 10 }];
    expect(suggestBin(bins, 'PLU', 20)).toBe('BIN-PLU-02');
    expect(suggestBin(bins, 'BAG', 20)).toBe('BIN-PLU-02');
    expect(suggestBin(bins, 'PLU', 500)).toBeNull();
  });
});
