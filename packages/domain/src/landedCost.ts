export type LandedBasis = 'value' | 'weight' | 'qty';
export interface LcLine { key: string; qty: number; valuePaise: number; weightGrams?: number }
export interface Charge { type: string; amountPaise: number }
export interface LcResult { key: string; allocatedPaise: number; addPerUnitPaise: number; landedUnitCostPaise: number }

/** Split `total` across weights in whole paise (largest-remainder), so the parts always sum to `total`. */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length) return [];
  if (sum <= 0) throw new Error('Cannot apportion: weights sum to zero');
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let rest = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) { if (rest <= 0) break; floors[o.i]! += 1; rest--; }
  return floors;
}

/** Landed cost = purchase cost + apportioned freight/customs/CHA/etc. IGST is NOT part of cost (it is input credit). */
export function landedCost(lines: LcLine[], charges: Charge[], basis: LandedBasis): { totalChargesPaise: number; lines: LcResult[] } {
  const total = charges.reduce((a, c) => a + c.amountPaise, 0);
  const weights = lines.map((l) => {
    if (basis === 'value') return l.valuePaise;
    if (basis === 'qty') return l.qty;
    if (l.weightGrams === undefined) throw new Error(`Weight missing for ${l.key}`);
    return l.weightGrams * l.qty;
  });
  const parts = apportion(total, weights);
  return {
    totalChargesPaise: total,
    lines: lines.map((l, i) => {
      const allocated = parts[i]!;
      const add = l.qty ? Math.round(allocated / l.qty) : 0;
      return { key: l.key, allocatedPaise: allocated, addPerUnitPaise: add, landedUnitCostPaise: l.qty ? Math.round((l.valuePaise + allocated) / l.qty) : 0 };
    }),
  };
}
