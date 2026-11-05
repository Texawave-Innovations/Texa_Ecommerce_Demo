import { HttpsError } from 'firebase-functions/v2/https';
import type { Transaction } from 'firebase-admin/firestore';
import { canSeeStore, type Bucket, type StockDoc } from '@texafashions/types';
import { counterId, financialYear, formatDocNumber, wacAfterReceipt, type MatrixRule } from '@texafashions/domain';
import { FieldValue, col, db, writeAudit, type Caller } from './admin';

export const ymd = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

export type Kind = 'receipt' | 'issue' | 'move' | 'adjust' | 'reval' | 'opening';
export interface Movement {
  locationId: string; skuId: string; bucket: Bucket; qty: number; kind: Kind; refType: string; refId: string;
  unitCostPaise?: number; reason?: string; binId?: string; at?: Date;
  /** POS sales may oversell (stock records lag the shelf); the balance goes negative and is flagged. */
  allowNegative?: boolean;
}

const ZERO = { onHand: 0, inQC: 0, inTransit: 0, damaged: 0, tester: 0, reserved: 0, revealed: 0, unputaway: 0, avgCostPaise: 0 };
export const stockId = (loc: string, sku: string) => `${loc}_${sku}`;

/**
 * Stock engine: the only code that changes stock. Usage inside a Firestore transaction:
 *   1) perform ALL reads (including `StockEngine.load`)  2) call `move()` any number of times  3) `commit()` writes ledger rows + summaries.
 * Ledger rows are append-only; summary docs are updated in the same transaction.
 */
export class StockEngine {
  private docs = new Map<string, StockDoc>();
  private touched = new Set<string>();
  private locked = new Set<string>();
  private rows: Record<string, unknown>[] = [];
  private constructor(private ignoreLock: boolean) {}

  static async load(tx: Transaction, pairs: [string, string][], opts: { ignoreLock?: boolean } = {}): Promise<StockEngine> {
    const e = new StockEngine(!!opts.ignoreLock);
    const uniq = [...new Map(pairs.map(([l, s]) => [stockId(l, s), [l, s] as [string, string]])).values()];
    const locs = [...new Set(uniq.map(([l]) => l))];
    const refs = [...uniq.map(([l, s]) => col('stock').doc(stockId(l, s))), ...locs.map((l) => col('stockLocks').doc(l))];
    const snaps = refs.length ? await tx.getAll(...refs) : [];
    uniq.forEach(([l, s], i) => {
      const snap = snaps[i]!;
      e.docs.set(stockId(l, s), snap.exists ? ({ ...ZERO, ...(snap.data() as object), id: snap.id, locationId: l, skuId: s } as StockDoc) : ({ ...ZERO, id: stockId(l, s), locationId: l, skuId: s } as StockDoc));
    });
    locs.forEach((l, i) => { if (snaps[uniq.length + i]?.exists && snaps[uniq.length + i]!.get('frozen')) e.locked.add(l); });
    return e;
  }

  get(loc: string, sku: string): StockDoc {
    const d = this.docs.get(stockId(loc, sku));
    if (!d) throw new Error(`Stock ${loc}/${sku} not loaded`);
    return d;
  }

  /** Applies a movement in memory and queues its ledger row. Returns the unit cost used (avg cost for issues). */
  move(m: Movement): number {
    if (m.qty === 0) return 0;
    if (this.locked.has(m.locationId) && !this.ignoreLock) throw new HttpsError('failed-precondition', `${m.locationId} is frozen for a stock-take`);
    const d = this.get(m.locationId, m.skuId);
    const before = d[m.bucket] as number;
    const after = before + m.qty;
    if (after < 0 && !m.allowNegative) throw new HttpsError('failed-precondition', `Insufficient ${m.bucket} stock for ${m.skuId} at ${m.locationId}: have ${before}, need ${-m.qty}`);
    const cost = m.unitCostPaise ?? d.avgCostPaise;
    if (m.qty > 0 && m.kind === 'receipt' && m.unitCostPaise !== undefined && (m.bucket === 'onHand' || m.bucket === 'inQC')) {
      d.avgCostPaise = wacAfterReceipt(d.onHand + d.inQC, d.avgCostPaise, m.qty, m.unitCostPaise);
    }
    if (m.kind === 'opening' && m.unitCostPaise !== undefined) d.avgCostPaise = m.unitCostPaise;
    (d[m.bucket] as number) = after;
    this.touched.add(d.id);
    this.rows.push({ locationId: m.locationId, skuId: m.skuId, bucket: m.bucket, qty: m.qty, balanceAfter: after, unitCostPaise: cost, kind: m.kind, refType: m.refType, refId: m.refId, reason: m.reason ?? null, binId: m.binId ?? null, day: ymd(m.at), atOverride: m.at ?? null });
    return cost;
  }

  /** Revalue held stock by a total value delta (landed cost) without changing quantity. */
  revalue(loc: string, sku: string, deltaValuePaise: number, refType: string, refId: string) {
    const d = this.get(loc, sku);
    const held = d.onHand + d.inQC;
    if (held <= 0) return;
    d.avgCostPaise = Math.round((d.avgCostPaise * held + deltaValuePaise) / held);
    this.touched.add(d.id);
    this.rows.push({ locationId: loc, skuId: sku, bucket: 'onHand', qty: 0, balanceAfter: d.onHand, unitCostPaise: d.avgCostPaise, kind: 'reval', refType, refId, reason: `Landed cost ${deltaValuePaise}`, binId: null, day: ymd(), valueDeltaPaise: deltaValuePaise });
  }

  /** Records which bin holds putaway stock (summary only; the ledger row is written by `move`). */
  setBin(loc: string, sku: string, binId: string, delta: number) {
    const d = this.get(loc, sku);
    d.bins = { ...(d.bins ?? {}) };
    d.bins[binId] = (d.bins[binId] ?? 0) + delta;
    if (d.bins[binId]! <= 0) delete d.bins[binId];
    this.touched.add(d.id);
  }
  /** Putaway: stock stays "on hand" at the warehouse but is now located in a bin. Writes a zero-qty ledger row for traceability. */
  putaway(loc: string, sku: string, binId: string, qty: number, refId: string) {
    const d = this.get(loc, sku);
    if (qty > (d.unputaway ?? 0)) throw new HttpsError('failed-precondition', `Only ${d.unputaway ?? 0} units of ${sku} are waiting for putaway`);
    this.setBin(loc, sku, binId, qty);
    d.unputaway = (d.unputaway ?? 0) - qty;
    this.rows.push({ locationId: loc, skuId: sku, bucket: 'onHand', qty: 0, balanceAfter: d.onHand, unitCostPaise: d.avgCostPaise, kind: 'putaway', refType: 'putaway', refId, reason: `${qty} → ${binId}`, binId, day: ymd(), atOverride: null });
  }
  /** Zero-quantity ledger row (reveal, count start, …) so state changes without a quantity change stay traceable. */
  annotate(loc: string, sku: string, kind: string, refType: string, refId: string, reason: string) {
    const d = this.get(loc, sku);
    this.touched.add(d.id);
    this.rows.push({ locationId: loc, skuId: sku, bucket: 'onHand', qty: 0, balanceAfter: d.onHand, unitCostPaise: d.avgCostPaise, kind, refType, refId, reason, binId: null, day: ymd(), atOverride: null });
  }
  setField(loc: string, sku: string, field: 'unputaway' | 'revealed', value: number) {
    const d = this.get(loc, sku); (d[field] as number) = Math.max(0, value); this.touched.add(d.id);
  }

  commit(tx: Transaction, c: Caller) {
    for (const id of this.touched) {
      const d = this.docs.get(id)!;
      const { id: _id, ...rest } = d; void _id;
      tx.set(col('stock').doc(id), { ...rest, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    for (const r of this.rows) { const { atOverride, ...row } = r as { atOverride: Date | null } & Record<string, unknown>; tx.set(col('stockLedger').doc(), { ...row, userId: c.uid, userName: c.name, at: atOverride ?? FieldValue.serverTimestamp() }); }
  }
  get writeCount() { return this.touched.size + this.rows.length; }
}

/** Reads the counter now; call `.write()` after all reads are done. */
export async function reserveNumber(tx: Transaction, docType: string, storeCode: string) {
  const key = { docType, storeCode, fy: financialYear(new Date()) };
  const ref = col('counters').doc(counterId(key));
  const snap = await tx.get(ref);
  const seq = ((snap.exists ? (snap.get('seq') as number) : 0) ?? 0) + 1;
  return { number: formatDocNumber(key, seq), write: () => tx.set(ref, { seq, docType, storeCode, fy: key.fy, updatedAt: FieldValue.serverTimestamp() }, { merge: true }) };
}

export async function loadMatrix(): Promise<MatrixRule[]> {
  const s = await col('approvalMatrix').where('status', '==', 'active').get();
  return s.docs.map((d) => d.data() as MatrixRule);
}
export async function getMasterDocs<T = Record<string, any>>(master: string, ids: string[]): Promise<Map<string, T>> {
  const uniq = [...new Set(ids)];
  const out = new Map<string, T>();
  if (!uniq.length) return out;
  const snaps = await db.getAll(...uniq.map((i) => col(master).doc(i)));
  snaps.forEach((s) => { if (s.exists) out.set(s.id, s.data() as T); });
  return out;
}
export function must<T>(v: T | undefined | null, msg: string): T { if (v === undefined || v === null) throw new HttpsError('not-found', msg); return v; }
export function fail(msg: string): never { throw new HttpsError('failed-precondition', msg); }

export const STAFF_ALL: Caller['claims']['role'][] = ['super_admin', 'cfo', 'buyer', 'warehouse_manager', 'store_manager'];
export function requireRoles(c: Caller, ...roles: Caller['claims']['role'][]) {
  if (c.claims.role !== 'super_admin' && !roles.includes(c.claims.role)) throw new HttpsError('permission-denied', `Role ${c.claims.role} cannot do this`);
}
export function requireLocation(c: Caller, locationId: string) {
  if (!canSeeStore(c.claims, locationId)) throw new HttpsError('permission-denied', `No access to ${locationId}`);
}
export const audit = writeAudit;
export const stamp = () => FieldValue.serverTimestamp();
