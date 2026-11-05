/** Indian retail seasonality multipliers by month (0=Jan). Festive Oct–Nov peak, Dec gifting, Jun–Jul lull. */
const MONTH_FACTOR = [0.95, 0.95, 1.0, 0.95, 0.95, 0.85, 0.85, 1.05, 1.0, 1.3, 1.5, 1.25];
export function seasonalityFactor(date: Date, weekendBoost = 1.0): number {
  const ist = new Date(date.getTime() + 5.5 * 3600_000);
  return MONTH_FACTOR[ist.getUTCMonth()]! * weekendBoost;
}
/** Holt-style seasonal moving average: blends the recent mean with the seasonal index of the horizon month. */
export function forecastDailyDemand(recentDaily: number[], horizon: Date, baseMonth: Date): number {
  if (!recentDaily.length) return 0;
  const mean = recentDaily.reduce((a, b) => a + b, 0) / recentDaily.length;
  return mean * (seasonalityFactor(horizon) / seasonalityFactor(baseMonth));
}

export interface ReplInput { dailyDemand: number; onHand: number; onOrder: number; inTransit: number; min?: number; max?: number; leadTimeDays: number; coverDays?: number; safetyDays?: number; date?: Date }
export interface ReplResult { suggestQty: number; reorderPoint: number; targetStock: number; position: number; daysOfCover: number; urgency: 'critical' | 'high' | 'normal'; reason: string }

export function suggestReplenishment(i: ReplInput): ReplResult {
  const coverDays = i.coverDays ?? 14, safetyDays = i.safetyDays ?? 5;
  const demand = i.dailyDemand * seasonalityFactor(i.date ?? new Date());
  const safety = Math.ceil(demand * safetyDays);
  const reorderPoint = Math.max(i.min ?? 0, Math.ceil(demand * i.leadTimeDays) + safety);
  const targetStock = Math.max(i.max ?? 0, Math.ceil(demand * (i.leadTimeDays + coverDays)) + safety);
  const position = i.onHand + i.onOrder + i.inTransit;
  const daysOfCover = demand > 0 ? i.onHand / demand : 999;
  const suggestQty = position <= reorderPoint ? Math.max(0, targetStock - position) : 0;
  const urgency = suggestQty > 0 && daysOfCover < i.leadTimeDays ? (i.onHand === 0 ? 'critical' : 'high') : 'normal';
  const reason = suggestQty > 0
    ? `Position ${position} ≤ reorder point ${reorderPoint} (demand ${demand.toFixed(2)}/day × ${i.leadTimeDays}d lead + ${safety} safety). Order up to ${targetStock}.`
    : `Position ${position} above reorder point ${reorderPoint}.`;
  return { suggestQty, reorderPoint, targetStock, position, daysOfCover: Math.round(daysOfCover * 10) / 10, urgency, reason };
}
