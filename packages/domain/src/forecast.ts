/** Seasonal moving-average demand forecast by weekday for one SKU × store. Pure TS; days are IST `YYYY-MM-DD` strings. */
export interface DailyQty { day: string; qty: number }
export interface ForecastPoint { day: string; qty: number }

const DAY_MS = 86_400_000;
export const addDay = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
export const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/**
 * For each future day, averages the last `weeks` same-weekday observations (missing days count as 0 sold, since history is sparse sales rows).
 * `history` should span the look-back window ending the day before `from`; fewer than 7 days of history falls back to the flat mean.
 */
export function forecastByWeekday(history: DailyQty[], from: string, horizonDays: number, weeks = 4): ForecastPoint[] {
  const byDay = new Map<string, number>();
  for (const h of history) byDay.set(h.day, (byDay.get(h.day) ?? 0) + h.qty);
  const days = [...byDay.keys()].sort();
  if (!days.length) return Array.from({ length: horizonDays }, (_, i) => ({ day: addDay(from, i), qty: 0 }));
  const flat = [...byDay.values()].reduce((a, b) => a + b, 0) / Math.max(1, (new Date(`${from}T00:00:00Z`).getTime() - new Date(`${days[0]}T00:00:00Z`).getTime()) / DAY_MS);
  const out: ForecastPoint[] = [];
  for (let i = 0; i < horizonDays; i++) {
    const day = addDay(from, i);
    let sum = 0, n = 0;
    for (let w = 1; w <= weeks; w++) {
      const past = addDay(day, -7 * w);
      if (past >= from || past < days[0]!) continue;   // outside the observed window
      sum += byDay.get(past) ?? 0; n++;
    }
    out.push({ day, qty: Math.round((n ? sum / n : flat) * 100) / 100 });
  }
  return out;
}

export const totalForecast = (f: ForecastPoint[], days = f.length) => f.slice(0, days).reduce((a, p) => a + p.qty, 0);

/** Days until on-hand runs out against the forecast (999 = no demand in horizon). */
export function daysOfCover(onHand: number, f: ForecastPoint[]): number {
  let left = onHand;
  for (let i = 0; i < f.length; i++) {
    const d = f[i]!.qty;
    if (left <= d) return Math.round((i + (d > 0 ? left / d : 0)) * 10) / 10;
    left -= d;
  }
  const avg = totalForecast(f) / Math.max(1, f.length);
  return avg > 0 ? Math.round((f.length + left / avg) * 10) / 10 : 999;
}

export interface ReplenishmentSuggestion { suggestQty: number; daysOfCover: number; reason: string }
/** Order enough to cover lead time + `coverDays` of forecast demand, net of stock already on order / in transit. */
export function forecastReplenishment(i: { onHand: number; onOrder?: number; inTransit?: number; forecast: ForecastPoint[]; leadTimeDays: number; coverDays?: number }): ReplenishmentSuggestion {
  const coverDays = i.coverDays ?? 14;
  const need = Math.ceil(totalForecast(i.forecast, i.leadTimeDays + coverDays));
  const position = i.onHand + (i.onOrder ?? 0) + (i.inTransit ?? 0);
  const cover = daysOfCover(i.onHand, i.forecast);
  const suggestQty = Math.max(0, need - position);
  return { suggestQty, daysOfCover: cover, reason: suggestQty > 0 ? `Forecast ${need} units over ${i.leadTimeDays}d lead + ${coverDays}d cover vs position ${position}` : `Position ${position} covers forecast ${need}` };
}

export interface MarkdownSuggestion { markdownPct: number; weeksOfCover: number; reason: string }
/** Suggests a markdown when forecast demand would take > 8 weeks to clear what's on hand (and there is meaningful stock). */
export function forecastMarkdown(i: { onHand: number; forecast: ForecastPoint[]; minUnits?: number }): MarkdownSuggestion | null {
  if (i.onHand < (i.minUnits ?? 10)) return null;
  const perWeek = (totalForecast(i.forecast, 28) / 28) * 7;
  const weeks = perWeek > 0 ? i.onHand / perWeek : 99;
  if (weeks <= 8) return null;
  const markdownPct = weeks > 16 ? 30 : weeks > 12 ? 20 : 10;
  return { markdownPct, weeksOfCover: Math.round(weeks * 10) / 10, reason: `${i.onHand} on hand vs ~${perWeek.toFixed(1)}/week forecast = ${weeks >= 99 ? '99+' : weeks.toFixed(1)} weeks of cover` };
}
