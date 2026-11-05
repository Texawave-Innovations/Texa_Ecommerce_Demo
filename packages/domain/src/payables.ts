export const tdsAmount = (basePaise: number, ratePct: number) => Math.round((basePaise * ratePct) / 100);

/** MSME Act: payment due within 45 days of acceptance, regardless of longer agreed terms. */
export function dueDate(invoiceDate: Date, termsDays: number, isMsme: boolean): Date {
  const days = isMsme ? Math.min(termsDays, 45) : termsDays;
  return new Date(invoiceDate.getTime() + days * 86_400_000);
}
export const daysUntil = (d: Date, now = new Date()) => Math.ceil((d.getTime() - now.getTime()) / 86_400_000);

/** Convert currency minor units (major×100) to INR paise using INR-paise-per-1-major-unit. */
export const toInrPaise = (minor: number, ratePaisePerUnit: number) => Math.round((minor * ratePaisePerUnit) / 100);
