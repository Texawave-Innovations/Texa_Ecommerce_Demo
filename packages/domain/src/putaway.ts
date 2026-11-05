export interface BinInfo { id: string; capacityUnits: number; departmentId?: string; used: number }
/** Prefer a bin assigned to the SKU's department with room; fall back to emptiest general bin. Excludes QC/damaged cages. */
export function suggestBin(bins: BinInfo[], departmentId: string | undefined, qty: number): string | null {
  const usable = bins.filter((b) => !/^BIN-(QC|DMG)/.test(b.id) && b.capacityUnits - b.used >= qty);
  const preferred = usable.filter((b) => b.departmentId && b.departmentId === departmentId).sort((a, b) => a.used - b.used);
  const fallback = usable.filter((b) => !b.departmentId).sort((a, b) => a.used - b.used);
  return (preferred[0] ?? fallback[0] ?? usable.sort((a, b) => a.used - b.used)[0])?.id ?? null;
}
/** Deterministic mock e-way bill number (12 digits). Real numbers come from the GSP in production. */
export function mockEwayNumber(seed: string): string {
  let h = 7; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 1_000_000_007;
  return String(3_000_000_000_00 + (h % 99_999_999_999)).padStart(12, '3').slice(0, 12);
}
