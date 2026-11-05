import { Timestamp } from '../admin';

/** Firestore Timestamps → ISO strings, recursively (callable responses and SaleDoc shape). */
export function plain<T = Record<string, any>>(v: unknown): T {
  if (v instanceof Timestamp) return v.toDate().toISOString() as never;
  if (Array.isArray(v)) return v.map((x) => plain(x)) as never;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, plain(x)])) as never;
  return v as T;
}
export const isoOf = (v: unknown): string | undefined => (v instanceof Timestamp ? v.toDate().toISOString() : typeof v === 'string' ? v : undefined);
export const sanitiseId = (n: string) => n.replace(/\//g, '-');
