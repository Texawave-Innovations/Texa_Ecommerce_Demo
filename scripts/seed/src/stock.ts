import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { ORG_ID } from '@texafashions/types';
import type { SkuSeed } from './catalogue';
import { rng } from './rng';

const DEPT_FACTOR: Record<string, number> = { PLU: 1.3, STA: 1.1, BAG: 0.8, KLV: 0.7, LIF: 0.9, CAR: 1.0 };
const STORE_AREA: Record<string, number> = { 'PUN-PMC': 1450, 'MUM-PMC': 1600, 'BLR-CS': 1100, 'BLR-M5': 1250, 'BLR-FS': 1300, 'HYD-NX': 1500, 'HYD-SC': 1700, 'NSK-CC': 1000 };
const DAY = 86_400_000;

/** Opening balances: stock summary + dated "opening" ledger layers (so FIFO valuation and ageing have real history). */
export async function seedStock(db: Firestore, skus: SkuSeed[], storeCodes: string[]) {
  const r = rng(99);
  const writes: { path: string; data: Record<string, unknown> }[] = [];
  const whDemand = new Map<string, number>();
  const now = Date.now();
  const mkLayers = (qty: number, avg: number, dead: boolean) => {
    const n = qty > 6 ? r.int(1, 3) : 1; const parts: number[] = []; let left = qty;
    for (let i = 0; i < n; i++) { const q = i === n - 1 ? left : Math.max(1, Math.floor(left / (n - i)) + r.int(-2, 2)); parts.push(Math.min(q, left)); left -= parts[i]!; }
    return parts.filter((q) => q > 0).map((q) => ({ qty: q, unitCostPaise: Math.round(avg * (0.92 + r.next() * 0.16)), ageDays: dead ? r.int(100, 300) : r.int(1, 110) }));
  };
  const put = (loc: string, s: SkuSeed, onHand: number, demand: number, dead: boolean, bins?: Record<string, number>) => {
    const layers = onHand > 0 ? mkLayers(onHand, s.costPaise, dead) : [];
    const total = layers.reduce((a, l) => a + l.qty, 0);
    const avg = total ? Math.round(layers.reduce((a, l) => a + l.qty * l.unitCostPaise, 0) / total) : s.costPaise;
    writes.push({ path: `orgs/${ORG_ID}/stock/${loc}_${s.code}`, data: { locationId: loc, skuId: s.code, onHand: total, inQC: 0, inTransit: 0, damaged: 0, tester: 0, reserved: loc === 'WH-CENTRAL' ? 0 : Math.min(total, r.int(0, 2)), revealed: 0, unputaway: 0, avgCostPaise: avg, dailyDemand: Math.round(demand * 100) / 100, bins: bins ?? {}, updatedAt: Timestamp.now() } });
    layers.forEach((l, li) => writes.push({ path: `orgs/${ORG_ID}/stockLedger/${loc}_${s.code}_${li}`, data: { locationId: loc, skuId: s.code, bucket: 'onHand', qty: l.qty, balanceAfter: total, unitCostPaise: l.unitCostPaise, kind: 'opening', refType: 'opening', refId: 'OPENING', reason: 'Opening balance', binId: null, day: new Date(now - l.ageDays * DAY).toISOString().slice(0, 10), userId: 'seed', userName: 'Seed', at: Timestamp.fromMillis(now - l.ageDays * DAY) } }));
  };
  for (const s of skus) {
    for (const loc of storeCodes) {
      const demand = (0.05 + r.next() * 0.85) * (DEPT_FACTOR[s.departmentId] ?? 1) * (STORE_AREA[loc]! / 1300) * 0.6;
      const roll = r.next();
      let onHand: number; let dead = false;
      if (roll < 0.12) onHand = Math.floor(demand * r.int(0, 3));            // low → replenishment suggestions
      else if (roll < 0.18) { onHand = Math.ceil(demand * r.int(160, 260)) + 6; dead = true; } // overstock / ageing
      else onHand = Math.ceil(demand * r.int(8, 45)) + 1;
      if (onHand > 0 && s.isBlindBox) onHand = Math.max(onHand, 6);
      whDemand.set(s.code, (whDemand.get(s.code) ?? 0) + demand);
      put(loc, s, onHand, demand, dead);
    }
  }
  // Warehouse with bin placement
  const binUse = new Map<string, number>(); const binsFor = (dept: string) => [1, 2, 3, 4].map((k) => `BIN-${dept}-0${k}`);
  skus.forEach((s, i) => {
    const demand = whDemand.get(s.code) ?? 0;
    const onHand = r.chance(0.05) ? 0 : Math.ceil(demand * r.int(20, 70)) + 2;
    const bin = binsFor(s.departmentId).find((b) => (binUse.get(b) ?? 0) + onHand <= 1800) ?? binsFor(s.departmentId)[i % 4]!;
    binUse.set(bin, (binUse.get(bin) ?? 0) + onHand);
    put('WH-CENTRAL', s, onHand, demand, false, onHand > 0 ? { [bin]: onHand } : {});
  });
  for (let i = 0; i < writes.length; i += 450) {
    const b = db.batch();
    writes.slice(i, i + 450).forEach((w) => b.set(db.doc(w.path), w.data));
    await b.commit();
  }
  return writes.length;
}
