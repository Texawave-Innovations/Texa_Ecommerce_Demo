/** All money is integer paise. */
export const rupeesToPaise = (r: number): number => Math.round(r * 100);
export const paiseToRupees = (p: number): number => p / 100;

export function formatINR(paise: number, opts: { compact?: boolean } = {}): string {
  const r = paise / 100;
  if (opts.compact) {
    if (Math.abs(r) >= 1e7) return `₹${(r / 1e7).toFixed(2)}Cr`;
    if (Math.abs(r) >= 1e5) return `₹${(r / 1e5).toFixed(2)}L`;
    if (Math.abs(r) >= 1e3) return `₹${(r / 1e3).toFixed(1)}K`;
  }
  return '₹' + r.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Percentage of an amount, rounded half-up to whole paise. */
export const percentOf = (paise: number, pct: number): number => Math.round((paise * pct) / 100);
