/** Weighted-average cost after receiving `qty` at `unitCost` into `heldQty` units valued at `avgCost`. */
export function wacAfterReceipt(heldQty: number, avgCostPaise: number, qty: number, unitCostPaise: number): number {
  const total = heldQty + qty;
  if (total <= 0) return unitCostPaise;
  return Math.round((heldQty * avgCostPaise + qty * unitCostPaise) / total);
}
export interface CostLayer { qty: number; unitCostPaise: number; atMs: number }
export interface FifoResult { valuePaise: number; used: CostLayer[] }

/** FIFO value of what is on hand: the newest receipts make up the remaining stock (oldest are consumed first). */
export function fifoValue(layers: CostLayer[], onHand: number): FifoResult {
  const newestFirst = [...layers].sort((a, b) => b.atMs - a.atMs);
  let need = onHand, value = 0;
  const used: CostLayer[] = [];
  for (const l of newestFirst) {
    if (need <= 0) break;
    const q = Math.min(l.qty, need);
    value += q * l.unitCostPaise; need -= q;
    used.push({ ...l, qty: q });
  }
  return { valuePaise: value, used };
}
export const AGE_BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];
export function ageBucket(ageDays: number): AgeBucket { return ageDays <= 30 ? '0-30' : ageDays <= 60 ? '31-60' : ageDays <= 90 ? '61-90' : '90+'; }
export function ageing(used: CostLayer[], nowMs: number): Record<AgeBucket, { qty: number; valuePaise: number }> {
  const out: Record<AgeBucket, { qty: number; valuePaise: number }> = { '0-30': { qty: 0, valuePaise: 0 }, '31-60': { qty: 0, valuePaise: 0 }, '61-90': { qty: 0, valuePaise: 0 }, '90+': { qty: 0, valuePaise: 0 } };
  for (const l of used) { const b = out[ageBucket(Math.floor((nowMs - l.atMs) / 86_400_000))]; b.qty += l.qty; b.valuePaise += l.qty * l.unitCostPaise; }
  return out;
}
/** ABC class by cumulative value share: A = top 70%, B = next 20%, C = rest. */
export function abcClasses(items: { key: string; valuePaise: number }[]): Record<string, 'A' | 'B' | 'C'> {
  const sorted = [...items].sort((a, b) => b.valuePaise - a.valuePaise);
  const total = sorted.reduce((s, i) => s + i.valuePaise, 0) || 1;
  let cum = 0; const out: Record<string, 'A' | 'B' | 'C'> = {};
  for (const i of sorted) { out[i.key] = cum / total < 0.7 ? 'A' : cum / total < 0.9 ? 'B' : 'C'; cum += i.valuePaise; }
  return out;
}
