import type { Transaction, DocumentReference } from 'firebase-admin/firestore';
import type { z } from 'zod';
import {
  AgeingInput, PostAdjustmentInput, ReconcileCountInput, RevealBlindBoxInput, StartCountInput, SubmitCountInput, ValuationInput,
  type AgeingRow, type CoverCell, type ValuationRow,
} from '@texafashions/types';
import { abcClasses, ageing, fifoValue, routeApproval, type CostLayer } from '@texafashions/domain';
import { FieldValue, col, db, type Caller } from './admin';
import { StockEngine, audit, fail, getMasterDocs, loadMatrix, must, requireLocation, requireRoles, reserveNumber } from './engine';

type Doc = Record<string, any>;
const INV_ROLES = ['store_manager', 'warehouse_manager'] as const;

// ───────────────────────── Adjustments
export async function applyAdjustmentEffects(tx: Transaction, c: Caller, ref: DocumentReference, d: Doc, decided: Doc) {
  const eng = await StockEngine.load(tx, [[d.locationId, d.skuId]]);
  const q = Math.abs(d.qtyDelta as number);
  if (d.toBucket) {
    // negative delta: move on-hand units INTO tester/damaged; positive: move them back to on-hand
    const [from, to] = d.qtyDelta < 0 ? (['onHand', d.toBucket] as const) : ([d.toBucket, 'onHand'] as const);
    eng.move({ locationId: d.locationId, skuId: d.skuId, bucket: from, qty: -q, kind: 'move', refType: 'adjustment', refId: ref.id, reason: d.reasonCode });
    eng.move({ locationId: d.locationId, skuId: d.skuId, bucket: to, qty: q, kind: 'move', refType: 'adjustment', refId: ref.id, reason: d.reasonCode });
  } else eng.move({ locationId: d.locationId, skuId: d.skuId, bucket: 'onHand', qty: d.qtyDelta, kind: 'adjust', refType: 'adjustment', refId: ref.id, reason: d.reasonCode });
  eng.commit(tx, c);
  tx.set(ref, { ...d, status: 'posted', postedAt: FieldValue.serverTimestamp(), ...decided }, { merge: true });
}

export async function postAdjustment(c: Caller, input: z.output<typeof PostAdjustmentInput>) {
  requireRoles(c, ...INV_ROLES);
  requireLocation(c, input.locationId);
  const [reason, stock, sku] = await Promise.all([col('reasonCodes').doc(input.reasonCode).get(), col('stock').doc(`${input.locationId}_${input.skuId}`).get(), col('skus').doc(input.skuId).get()]);
  if (!reason.exists || reason.get('context') !== 'stock_adjustment') fail('Choose a stock-adjustment reason code');
  must(sku.exists ? sku.data() : null, 'Unknown SKU');
  const avg = (stock.get('avgCostPaise') as number | undefined) ?? (sku.get('costPaise') as number) ?? 0;
  const value = Math.abs(input.qtyDelta) * avg;
  const matrix = await loadMatrix();
  const route = routeApproval('ADJUSTMENT', value, matrix, { role: c.claims.role, approvalLimitPaise: c.claims.approvalLimitPaise });
  const needsApproval = !route.autoApprove || (reason.get('needsApproval') === true && c.claims.role !== 'super_admin');
  const ref = col('adjustments').doc();
  return db.runTransaction(async (tx) => {
    const num = await reserveNumber(tx, 'ADJ', input.locationId);
    const base = { number: num.number, locationId: input.locationId, skuId: input.skuId, skuName: sku.get('name'), qtyDelta: input.qtyDelta, toBucket: input.toBucket ?? null, reasonCode: input.reasonCode, reasonName: reason.get('name'), note: input.note ?? null, valuePaise: value, approverRole: route.approverRole, requestedBy: c.uid, requestedByName: c.name, createdAt: FieldValue.serverTimestamp() };
    if (needsApproval) {
      num.write(); tx.set(ref, { ...base, status: 'pending_approval' });
      audit(tx, c, { action: 'request_adjustment', entity: 'adjustments', entityId: ref.id, before: null, after: { qtyDelta: input.qtyDelta, valuePaise: value } });
      return { id: ref.id, number: num.number, status: 'pending_approval', approverRole: route.approverRole };
    }
    await applyAdjustmentEffects(tx, c, ref, { ...base, status: 'pending_approval' }, { decidedBy: c.uid, decidedByName: `${c.name} (within authority)`, decidedAt: FieldValue.serverTimestamp() });
    num.write();
    audit(tx, c, { action: 'post_adjustment', entity: 'adjustments', entityId: ref.id, before: null, after: { qtyDelta: input.qtyDelta, valuePaise: value } });
    return { id: ref.id, number: num.number, status: 'posted' };
  });
}

// ───────────────────────── Counts (cycle count with ABC, blind count, full stock-take with freeze)
export async function startCount(c: Caller, input: z.output<typeof StartCountInput>) {
  requireRoles(c, ...INV_ROLES);
  requireLocation(c, input.locationId);
  const lock = await col('stockLocks').doc(input.locationId).get();
  if (lock.exists && lock.get('frozen')) fail(`${input.locationId} is already frozen for stock-take ${lock.get('countNumber')}`);
  const snap = await col('stock').where('locationId', '==', input.locationId).get();
  const rows = snap.docs.map((d) => d.data() as Doc).filter((s) => s.onHand > 0);
  const abc = abcClasses(rows.map((s) => ({ key: s.skuId, valuePaise: s.onHand * s.avgCostPaise })));
  let chosen = rows;
  if (input.type === 'cycle') { if (input.abcClass) chosen = rows.filter((s) => abc[s.skuId] === input.abcClass); chosen = chosen.sort((a, b) => b.onHand * b.avgCostPaise - a.onHand * a.avgCostPaise).slice(0, input.limit ?? 25); }
  else chosen = rows.sort((a, b) => b.onHand * b.avgCostPaise - a.onHand * a.avgCostPaise).slice(0, 400);
  if (!chosen.length) fail('Nothing to count at this location');
  const skus = await getMasterDocs<Doc>('skus', chosen.map((s) => s.skuId));
  const coll = input.type === 'full' ? 'stockTakes' : 'cycleCounts';
  const ref = col(coll).doc();
  return db.runTransaction(async (tx) => {
    const num = await reserveNumber(tx, input.type === 'full' ? 'ST' : 'CC', input.locationId); num.write();
    tx.set(ref, { number: num.number, type: input.type, collection: coll, locationId: input.locationId, abcClass: input.abcClass ?? null, status: 'counting', blind: true, lines: chosen.map((s) => ({ skuId: s.skuId, name: skus.get(s.skuId)?.name ?? s.skuId, abc: abc[s.skuId], expectedQty: s.onHand, countedQty: null, avgCostPaise: s.avgCostPaise })), startedBy: c.uid, startedByName: c.name, createdAt: FieldValue.serverTimestamp() });
    if (input.type === 'full') tx.set(col('stockLocks').doc(input.locationId), { frozen: true, countId: ref.id, countNumber: num.number, at: FieldValue.serverTimestamp() });
    audit(tx, c, { action: 'start_count', entity: coll, entityId: ref.id, before: null, after: { type: input.type, lines: chosen.length } });
    return { id: ref.id, number: num.number, collection: coll, lines: chosen.length };
  });
}
async function findCount(id: string): Promise<{ ref: DocumentReference; d: Doc }> {
  for (const coll of ['cycleCounts', 'stockTakes']) { const s = await col(coll).doc(id).get(); if (s.exists) return { ref: s.ref, d: s.data() as Doc }; }
  throw new Error('Count not found');
}
export async function submitCount(c: Caller, input: z.output<typeof SubmitCountInput>) {
  requireRoles(c, ...INV_ROLES);
  const { ref, d } = await findCount(input.countId);
  requireLocation(c, d.locationId);
  if (!['counting', 'counted'].includes(d.status)) fail(`Count is ${d.status}`);
  const by = new Map(input.counts.map((x) => [x.skuId, x.countedQty]));
  const lines = (d.lines as Doc[]).map((l) => (by.has(l.skuId) ? { ...l, countedQty: by.get(l.skuId) } : l));
  const complete = lines.every((l) => l.countedQty !== null && l.countedQty !== undefined);
  const b = db.batch();
  b.update(ref, { lines, status: complete ? 'counted' : 'counting', countedBy: c.uid, countedByName: c.name });
  audit(b, c, { action: 'submit_count', entity: d.collection, entityId: input.countId, before: null, after: { counted: input.counts.length, complete } });
  await b.commit();
  return { status: complete ? 'counted' : 'counting' };
}
export async function reconcileCount(c: Caller, input: z.output<typeof ReconcileCountInput>) {
  requireRoles(c, ...INV_ROLES);
  const { ref, d } = await findCount(input.countId);
  requireLocation(c, d.locationId);
  if (d.status !== 'counted') fail('Finish counting every line before reconciling');
  const lines = d.lines as Doc[];
  const varLines = lines.filter((l) => l.countedQty !== l.expectedQty);
  if (varLines.length > 230) fail('Too many variance lines for one reconciliation (max 230) — recount in smaller groups');
  return db.runTransaction(async (tx) => {
    const cur = must((await tx.get(ref)).data() as Doc | undefined, 'Count not found');
    if (cur.status !== 'counted') fail(`Count is ${cur.status}`);
    const eng = await StockEngine.load(tx, varLines.map((l) => [d.locationId, l.skuId] as [string, string]), { ignoreLock: true });
    let netValue = 0, absValue = 0;
    for (const l of varLines) {
      const delta = l.countedQty - l.expectedQty;
      eng.move({ locationId: d.locationId, skuId: l.skuId, bucket: 'onHand', qty: delta, kind: 'adjust', refType: d.type === 'full' ? 'stock_take' : 'cycle_count', refId: input.countId, reason: input.reasonCode });
      netValue += delta * l.avgCostPaise; absValue += Math.abs(delta) * l.avgCostPaise;
    }
    eng.commit(tx, c);
    tx.update(ref, { status: 'reconciled', varianceLines: varLines.length, netVariancePaise: netValue, absVariancePaise: absValue, reconciledBy: c.uid, reconciledAt: FieldValue.serverTimestamp() });
    if (d.type === 'full') tx.delete(col('stockLocks').doc(d.locationId));
    audit(tx, c, { action: 'reconcile_count', entity: d.collection, entityId: input.countId, before: null, after: { varianceLines: varLines.length, netVariancePaise: netValue } });
    return { varianceLines: varLines.length, netVariancePaise: netValue, absVariancePaise: absValue };
  });
}

export async function revealBlindBox(c: Caller, input: z.output<typeof RevealBlindBoxInput>) {
  requireRoles(c, ...INV_ROLES);
  requireLocation(c, input.locationId);
  const sku = must((await col('skus').doc(input.skuId).get()).data() as Doc | undefined, 'Unknown SKU');
  if (!sku.isBlindBox) fail(`${input.skuId} is not a blind box`);
  return db.runTransaction(async (tx) => {
    const eng = await StockEngine.load(tx, [[input.locationId, input.skuId]]);
    const s = eng.get(input.locationId, input.skuId);
    if (input.qty > s.onHand - (s.revealed ?? 0)) fail(`Only ${s.onHand - (s.revealed ?? 0)} sealed boxes available`);
    eng.setField(input.locationId, input.skuId, 'revealed', (s.revealed ?? 0) + input.qty);
    eng.annotate(input.locationId, input.skuId, 'reveal', 'blindbox', input.skuId, `${input.qty} box(es) opened/revealed`);
    eng.commit(tx, c);
    audit(tx, c, { action: 'reveal_blindbox', entity: 'stock', entityId: `${input.locationId}_${input.skuId}`, before: null, after: { qty: input.qty } });
    return { sealed: s.onHand - (s.revealed ?? 0) - input.qty, revealed: (s.revealed ?? 0) + input.qty };
  });
}

// ───────────────────────── Reports
async function layersFor(locationId: string): Promise<Map<string, CostLayer[]>> {
  const snap = await col('stockLedger').where('locationId', '==', locationId).where('kind', 'in', ['receipt', 'opening']).limit(8000).get();
  const out = new Map<string, CostLayer[]>();
  snap.docs.forEach((d) => {
    const r = d.data() as Doc;
    if (r.qty <= 0 || !['onHand', 'inQC'].includes(r.bucket) || r.unitCostPaise === undefined) return;
    const at = (r.at?.toMillis?.() as number | undefined) ?? Date.now();
    (out.get(r.skuId) ?? out.set(r.skuId, []).get(r.skuId)!).push({ qty: r.qty, unitCostPaise: r.unitCostPaise, atMs: at });
  });
  return out;
}
export async function inventoryValuation(c: Caller, input: z.output<typeof ValuationInput>) {
  requireRoles(c, 'cfo', 'warehouse_manager', 'store_manager', 'buyer', 'auditor' as never);
  requireLocation(c, input.locationId);
  const stock = (await col('stock').where('locationId', '==', input.locationId).get()).docs.map((d) => d.data() as Doc).filter((s) => s.onHand + s.inQC > 0);
  const layers = input.method === 'FIFO' ? await layersFor(input.locationId) : null;
  const rows: ValuationRow[] = stock.map((s) => {
    const qty = s.onHand + s.inQC;
    if (!layers) return { skuId: s.skuId, qty, unitCostPaise: s.avgCostPaise, valuePaise: qty * s.avgCostPaise };
    const f = fifoValue(layers.get(s.skuId) ?? [], qty);
    const covered = f.used.reduce((a, l) => a + l.qty, 0);
    const value = f.valuePaise + (qty - covered) * s.avgCostPaise; // any units without a receipt layer fall back to WAC
    return { skuId: s.skuId, qty, unitCostPaise: qty ? Math.round(value / qty) : 0, valuePaise: value };
  });
  return { method: input.method, rows, totalPaise: rows.reduce((a, r) => a + r.valuePaise, 0), totalQty: rows.reduce((a, r) => a + r.qty, 0) };
}
export async function inventoryAgeing(c: Caller, input: z.output<typeof AgeingInput>) {
  requireRoles(c, 'cfo', 'warehouse_manager', 'store_manager', 'buyer', 'auditor' as never);
  requireLocation(c, input.locationId);
  const stock = (await col('stock').where('locationId', '==', input.locationId).get()).docs.map((d) => d.data() as Doc).filter((s) => s.onHand > 0);
  const layers = await layersFor(input.locationId);
  const now = Date.now();
  const skus = await getMasterDocs<Doc>('skus', stock.map((s) => s.skuId));
  const rows: AgeingRow[] = []; const dead: Doc[] = [];
  const totals = { '0-30': { qty: 0, valuePaise: 0 }, '31-60': { qty: 0, valuePaise: 0 }, '61-90': { qty: 0, valuePaise: 0 }, '90+': { qty: 0, valuePaise: 0 } };
  for (const s of stock) {
    const f = fifoValue(layers.get(s.skuId) ?? [], s.onHand);
    const covered = f.used.reduce((a, l) => a + l.qty, 0);
    const used = covered < s.onHand ? [...f.used, { qty: s.onHand - covered, unitCostPaise: s.avgCostPaise, atMs: now }] : f.used;
    const b = ageing(used, now);
    rows.push({ skuId: s.skuId, total: s.onHand, buckets: b });
    (Object.keys(totals) as (keyof typeof totals)[]).forEach((k) => { totals[k].qty += b[k].qty; totals[k].valuePaise += b[k].valuePaise; });
    const old = b['90+'].qty, share = old / s.onHand, cover = (s.dailyDemand ?? 0) > 0 ? s.onHand / s.dailyDemand : 999;
    if (old >= 3 && (share >= 0.5 || cover > 120)) {
      const pct = share >= 0.8 || cover > 240 ? 30 : share >= 0.5 ? 20 : 10;
      dead.push({ skuId: s.skuId, name: skus.get(s.skuId)?.name ?? s.skuId, qty90: old, valuePaise: b['90+'].valuePaise, daysOfCover: Math.round(cover), suggestedMarkdownPct: pct, reason: `${Math.round(share * 100)}% of stock is 90+ days old with ~${cover > 900 ? '∞' : Math.round(cover)} days of cover` });
    }
  }
  return { totals, rows: rows.sort((a, b) => b.buckets['90+'].valuePaise - a.buckets['90+'].valuePaise).slice(0, 300), deadStock: dead.sort((a, b) => b.valuePaise - a.valuePaise).slice(0, 50) };
}
export async function coverHeatmap(c: Caller) {
  requireRoles(c, 'cfo', 'warehouse_manager', 'store_manager', 'buyer', 'auditor' as never);
  const [stock, skus] = await Promise.all([col('stock').get(), col('skus').get()]);
  const dept = new Map(skus.docs.map((s) => [s.id, (s.get('departmentId') as string) ?? '—']));
  const acc = new Map<string, { onHand: number; demand: number; storeId: string; departmentId: string }>();
  stock.docs.forEach((d) => {
    const s = d.data() as Doc; if (s.locationId === 'WH-CENTRAL') return;
    if (c.claims.role === 'store_manager' && !c.claims.storeIds.includes(s.locationId)) return;
    const k = `${s.locationId}|${dept.get(s.skuId)}`;
    const cur = acc.get(k) ?? { onHand: 0, demand: 0, storeId: s.locationId, departmentId: dept.get(s.skuId) ?? '—' };
    cur.onHand += s.onHand; cur.demand += s.dailyDemand ?? 0; acc.set(k, cur);
  });
  const cells: CoverCell[] = [...acc.values()].map((v) => ({ storeId: v.storeId, departmentId: v.departmentId, onHand: v.onHand, dailyDemand: Math.round(v.demand * 10) / 10, days: v.demand > 0 ? Math.round((v.onHand / v.demand) * 10) / 10 : 999 }));
  return { cells };
}
