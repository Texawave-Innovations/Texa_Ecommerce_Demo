/** Phase 3 seed: tills, POS staff (PIN hashes), promotions, vouchers, gift cards and a little real sale history via completeSaleCore. */
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { ORG_ID } from '@texafashions/types';
import { INR_DENOMINATIONS, priceCart, type Promotion } from '@texafashions/domain';
import type { SkuSeed } from './catalogue';

const P = (c: string) => `orgs/${ORG_ID}/${c}`;

export async function seedPos(db: Firestore, skus: SkuSeed[], stores: { code: string; name: string }[], names: string[]) {
  const { hashPin } = await import('../../../functions/src/pos/pin');
  const { completeSaleCore } = await import('../../../functions/src/pos/sale');
  const { openShift, closeShift } = await import('../../../functions/src/pos/shift');
  const log = (m: string) => console.log('  · ' + m);

  // ── tills + staff
  const auth = getAuth();
  const staff: { id: string; uid: string; name: string; role: 'cashier' | 'store_manager'; storeId: string }[] = [];
  let b = db.batch();
  stores.forEach((s, i) => {
    for (const t of ['T1', 'T2']) b.set(db.doc(`${P('tills')}/${s.code}-${t}`), { storeId: s.code, name: `Till ${t.slice(1)}`, openShiftId: null, openShiftNo: null });
    const cash = s.code === 'PUN-PMC' ? { uid: 'demo-cashier', name: 'Imran Shaikh' } : { uid: `pos-cash-${s.code}`, name: names[i * 2]! };
    const mgr = { uid: `pos-mgr-${s.code}`, name: s.code === 'PUN-PMC' ? 'Rahul Joshi' : names[i * 2 + 1]! };
    for (const [code, u, role, pin] of [['CSH01', cash, 'cashier', '1234'], ['MGR01', mgr, 'store_manager', '4321']] as const) {
      const id = `${s.code}_${code}`; staff.push({ id, uid: u.uid, name: u.name, role, storeId: s.code });
      b.set(db.doc(`${P('posUsers')}/${id}`), { uid: u.uid, name: u.name, role, storeIds: [s.code], employeeCode: code, ...hashPin(pin), failCount: 0, lockedUntil: 0 });
    }
  });
  await b.commit();
  for (const u of staff) {
    const claims = { role: u.role, storeIds: [u.storeId], approvalLimitPaise: u.role === 'store_manager' ? 10_000_000 : 0 };
    try { await auth.getUser(u.uid); } catch { await auth.createUser({ uid: u.uid, email: `${u.uid}@texafashions.demo`, displayName: u.name, password: 'demo-demo-1' }); }
    await auth.setCustomUserClaims(u.uid, claims);
  }
  log(`${stores.length * 2} tills, ${staff.length} POS staff (cashier PIN 1234 / manager PIN 4321)`);

  // ── promotions
  const sticker = skus.find((s) => s.subCategoryId === 'ST-STK')!;
  const promos: (Promotion & Record<string, unknown>)[] = [
    { id: 'P-STA-B2G1', name: 'Buy 2 Get 1 Free — Stationery', kind: 'bxgy', scope: { departmentIds: ['STA'] }, buyQty: 2, getQty: 1, discountPct: 100, priority: 20, stackable: true, status: 'active' },
    { id: 'P-BUNDLE', name: 'Plush + Pouch bundle @ ₹699', kind: 'bundle', items: [{ scope: { departmentIds: ['PLU'] }, qty: 1 }, { scope: { subCategoryIds: ['BG-PCH'] }, qty: 1 }], bundlePricePaise: 69_900, priority: 25, stackable: true, status: 'active' },
    { id: 'P-HAPPY', name: 'Weekend happy hour — Care 10% (Sat/Sun 4–6pm)', kind: 'happy_hour', scope: { departmentIds: ['CAR'] }, pct: 10, days: [0, 6], fromHour: 16, toHour: 18, priority: 15, stackable: true, status: 'active' },
    { id: 'P-STA-TIER', name: 'Stationery spend & save 5/10/15%', kind: 'tiered', scope: { departmentIds: ['STA'] }, tiers: [{ minPaise: 49_900, pct: 5 }, { minPaise: 99_900, pct: 10 }, { minPaise: 149_900, pct: 15 }], priority: 40, stackable: false, status: 'active' },
    { id: 'P-CART2K', name: '5% off above ₹2,000', kind: 'cart_threshold', minPaise: 200_000, inclusive: false, pct: 5, priority: 50, stackable: true, status: 'active' },
    { id: 'P-LOYALTY', name: 'Bestie 2% / Soulmate 4% member perk', kind: 'loyalty_tier', tierPcts: { BESTIE: 2, SEOULMATE: 4 }, priority: 60, stackable: true, status: 'active' },
    { id: 'P-UPI5', name: '5% off on UPI', kind: 'tender', tenders: ['UPI'], pct: 5, priority: 90, stackable: true, status: 'active' },
    { id: 'P-GIFT', name: 'Free sticker sheet above ₹1,499', kind: 'free_gift', minPaise: 149_900, gift: { skuId: sticker.code, name: sticker.name, mrpPaise: sticker.mrpPaise, gstRate: Number(sticker.gstRate), hsn: sticker.hsn, departmentId: sticker.departmentId, categoryId: sticker.categoryId, subCategoryId: sticker.subCategoryId, brandId: sticker.brandId }, priority: 70, stackable: true, status: 'draft' },
  ];
  b = db.batch();
  for (const p of promos) { const { id, ...rest } = p; b.set(db.doc(`${P('promotions')}/${id}`), { ...rest, createdAt: FieldValue.serverTimestamp(), createdBy: 'seed' }); }
  await b.commit();
  log(`${promos.length} promotions (P-GIFT is draft — needs stock of the gift SKU)`);

  // ── vouchers + gift cards
  b = db.batch();
  const V = (code: string, o: Record<string, unknown>) => b.set(db.doc(`${P('vouchers')}/${code}`), { code, usage: 'single', status: 'active', redemptionCount: 0, channel: 'All', validFrom: '2026-01-01', validTo: '2026-12-31', ...o, createdAt: FieldValue.serverTimestamp() });
  for (let n = 1; n <= 5; n++) V(`WEL-DEMO${n}`, { seriesId: 'VS-WELCOME', valuePaise: 10_000, minSpendPaise: 59_900, perCustomerLimit: 1 });
  V('BDY-DEMO1', { seriesId: 'VS-BDAY', percentOff: 10, maxDiscountPaise: 15_000, channel: 'Store', perCustomerLimit: 1 });
  V('EXP-DEMO1', { seriesId: 'VS-WELCOME', valuePaise: 10_000, validFrom: '2026-01-01', validTo: '2026-06-30' });
  V('LIM-DEMO1', { seriesId: 'VS-WELCOME', valuePaise: 5_000, usage: 'multi', perCustomerLimit: 1, minSpendPaise: 29_900 });
  const gc = (id: string, bal: number, o: Record<string, unknown> = {}) => {
    b.set(db.doc(`${P('giftCards')}/${id}`), { seriesId: 'GCS-PHYS', kind: 'Physical', balancePaise: bal, initialPaise: bal, status: 'active', expiresAt: '2027-10-31', storeId: 'PUN-PMC', issuedAt: FieldValue.serverTimestamp(), ...o });
    b.set(db.collection(`${P('giftCards')}/${id}/txns`).doc(), { kind: 'issue', amountPaise: bal, balanceAfterPaise: bal, storeId: 'PUN-PMC', tender: 'CASH', at: FieldValue.serverTimestamp() });
  };
  gc('GC-DEMO-0001', 100_000); gc('GC-DEMO-0002', 30_000); gc('GC-DEMO-EXP', 50_000, { expiresAt: '2026-06-30' }); gc('GC-DEMO-BLK', 50_000, { status: 'blocked' });
  await b.commit();
  log('8 vouchers (WEL-DEMO1..5, BDY-DEMO1, EXP-DEMO1, LIM-DEMO1) and 4 gift cards (GC-DEMO-0001/0002/EXP/BLK)');

  // ── history through the REAL handlers
  const caller = (storeId: string, role: 'cashier' | 'store_manager' = 'cashier') => { const u = staff.find((x) => x.storeId === storeId && x.role === role)!; return { uid: u.uid, name: u.name, claims: { role, storeIds: [storeId], approvalLimitPaise: 0 } } as never; };
  const pool = skus.filter((s) => s.pricePaise <= 99_900);
  let seq = 0; const pickSku = (n: number) => pool[(n * 7) % pool.length]!;
  const plan: [string, number, number, 'CASH' | 'UPI' | 'CARD', boolean][] = [
    ['PUN-PMC', 3, 2, 'CASH', true], ['MUM-PMC', 2, 2, 'UPI', true], ['BLR-FS', 2, 2, 'CARD', true], ['HYD-NX', 2, 2, 'CASH', false], ['NSK-CC', 1, 3, 'UPI', false], ['BLR-CS', 1, 2, 'CASH', false], ['HYD-SC', 1, 2, 'CARD', false],
  ];
  const custs = (await db.collection(P('customers')).limit(10).get()).docs.map((d) => d.id);
  let sales = 0;
  for (const [store, count, itemsPer, tender, close] of plan) {
    const c = caller(store); const till = `${store}-T1`;
    const sh = await openShift(c, { tillId: till, storeId: store, openingFloatPaise: 200_000 });
    let cashIn = 0;
    for (let n = 0; n < count; n++) {
      const lines = Array.from({ length: itemsPer }, (_, k) => ({ lineId: `L${k + 1}`, skuId: pickSku(++seq).code, qty: 1 + (k % 2) }));
      // Exact payable = what the server will compute (same engine, same promotions).
      const priced = priceCart(lines.map((l) => { const s = skus.find((x) => x.code === l.skuId)!; return { lineId: l.lineId, skuId: s.code, name: s.name, qty: l.qty, unitPricePaise: s.pricePaise, gstRate: Number(s.gstRate), departmentId: s.departmentId, categoryId: s.categoryId, subCategoryId: s.subCategoryId, brandId: s.brandId }; }), promos, { channel: 'store', storeId: store, at: new Date(), tender });
      const total = Math.round(priced.netPaise / 100) * 100;
      const pay = tender === 'CASH' ? [{ mode: 'CASH' as const, amountPaise: total + 100_000 }] : [{ mode: tender, amountPaise: total }];
      const r = await completeSaleCore(c, { clientSaleId: `seed-${store}-${n}-${Date.now().toString(36)}`, storeId: store, tillId: till, shiftId: sh.id, lines, customerId: n === 0 ? custs[sales % custs.length] : undefined, payments: pay as never });
      if (tender === 'CASH') cashIn += r.payablePaise; sales++;
    }
    if (close) {
      let left = Math.round((200_000 + cashIn) / 100); const den: Record<string, number> = {};
      for (const d of INR_DENOMINATIONS) { den[String(d)] = Math.floor(left / d); left -= den[String(d)]! * d; }
      await closeShift(c, { shiftId: sh.id, denominations: den, note: 'Seeded history' });
    }
  }
  log(`${sales} historical sales via completeSaleCore (PUN-PMC T1 has no open shift; MUM/BLR-FS closed with Z-reports; others left open)`);
}
