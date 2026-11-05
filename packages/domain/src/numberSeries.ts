/** Indian financial year label, e.g. 2026-11-04 → "26-27". Uses IST. */
export function financialYear(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 3600_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

export interface NumberSeriesKey { docType: string; storeCode: string; fy: string }
export const counterId = (k: NumberSeriesKey) => `${k.docType}_${k.storeCode}_${k.fy}`;

/** PO/BLR-FS/26-27/00001 */
export function formatDocNumber(k: NumberSeriesKey, seq: number, padding = 5): string {
  return `${k.docType}/${k.storeCode}/${k.fy}/${String(seq).padStart(padding, '0')}`;
}
