export interface VendorStats { onTimePct?: number; fillRatePct?: number; defectPct?: number }
/** 0–100 reliability score: 40% on-time, 30% fill rate, 30% quality (each 1% defect costs 5 points). */
export function vendorScore(v: VendorStats): number {
  const onTime = v.onTimePct ?? 80, fill = v.fillRatePct ?? 85, defect = v.defectPct ?? 3;
  return Math.round(0.4 * onTime + 0.3 * fill + 0.3 * Math.max(0, 100 - defect * 5));
}
export interface QuoteIn { vendorId: string; totalInrPaise: number; leadTimeDays: number; stats: VendorStats }
export interface QuoteScore { vendorId: string; priceScore: number; reliability: number; leadScore: number; total: number; rank: number }
/** Composite: 50% price (cheapest = 100), 35% reliability, 15% lead time (fastest = 100). */
export function scoreQuotes(quotes: QuoteIn[]): QuoteScore[] {
  if (!quotes.length) return [];
  const minPrice = Math.min(...quotes.map((q) => q.totalInrPaise)), minLead = Math.min(...quotes.map((q) => q.leadTimeDays));
  const rows = quotes.map((q) => {
    const priceScore = q.totalInrPaise > 0 ? Math.round((100 * minPrice) / q.totalInrPaise) : 0;
    const leadScore = q.leadTimeDays > 0 ? Math.round((100 * minLead) / q.leadTimeDays) : 100;
    const reliability = vendorScore(q.stats);
    return { vendorId: q.vendorId, priceScore, reliability, leadScore, total: Math.round(0.5 * priceScore + 0.35 * reliability + 0.15 * leadScore), rank: 0 };
  }).sort((a, b) => b.total - a.total);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}
