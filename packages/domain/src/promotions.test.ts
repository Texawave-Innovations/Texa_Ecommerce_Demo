import { describe, expect, it } from 'vitest';
import {
  buildInvoice, buildSaleJournal, checkGiftCard, checkVoucher, countDenominations, crossSell, earnPoints, journalBalanced, MockPaymentGateway, priceCart,
  redeemBalance, redeemPoints, refundForQty, reverseJournal, tierFor, topUpGiftCard, upiIntentUrl, zReport,
  type BundlePromo, type BxGyPromo, type CartLine, type CartThresholdPromo, type FreeGiftPromo, type HappyHourPromo, type LoyaltyTierPromo, type MarkdownPromo,
  type PricingContext, type Promotion, type TenderPromo, type TieredPromo, type Voucher,
} from './index';

const line = (id: string, price: number, qty = 1, extra: Partial<CartLine> = {}): CartLine => ({ lineId: id, skuId: id, name: id, qty, unitPricePaise: price * 100, gstRate: 12, departmentId: 'PLU', ...extra });
const AT = new Date('2026-11-04T10:00:00Z');        // Wednesday 15:30 IST
const ctx = (o: Partial<PricingContext> = {}): PricingContext => ({ channel: 'store', storeId: 'PUN-PMC', at: AT, ...o });

const UPI: TenderPromo = { id: 'P-UPI', name: 'UPI 5% off', kind: 'tender', tenders: ['UPI'], pct: 5, priority: 90, stackable: true };
const OVER2K: CartThresholdPromo = { id: 'P-2K', name: '5% off above ₹2,000', kind: 'cart_threshold', minPaise: 200_000, inclusive: false, pct: 5, priority: 50, stackable: true };
const net = (r: { netPaise: number }) => r.netPaise / 100;

describe('live offers: UPI 5% + 5% above ₹2,000', () => {
  const promos: Promotion[] = [UPI, OVER2K];
  it('stack sequentially on a ₹3,000 cart paid by UPI', () => {
    const r = priceCart([line('A', 1000, 3)], promos, ctx({ tender: 'UPI' }));
    // 3000 → −5% = 2850 → −5% of 2850 = 142.50 → 2707.50
    expect(r.applied.map((a) => [a.promoId, a.amountPaise])).toEqual([['P-2K', 15_000], ['P-UPI', 14_250]]);
    expect(r.netPaise).toBe(270_750);
    expect(r.discountPaise).toBe(29_250);
  });
  it('threshold only when paying cash; UPI only when below ₹2,000', () => {
    expect(net(priceCart([line('A', 1000, 3)], promos, ctx({ tender: 'CASH' })))).toBe(2850);
    expect(net(priceCart([line('A', 1500)], promos, ctx({ tender: 'UPI' })))).toBe(1425);
    expect(net(priceCart([line('A', 1500)], promos, ctx({ tender: 'CARD' })))).toBe(1500);
  });
  it('"above ₹2,000" is strictly above: exactly ₹2,000 does not qualify, ₹2,000.01 does', () => {
    expect(net(priceCart([line('A', 2000)], promos, ctx({ tender: 'CASH' })))).toBe(2000);
    const r = priceCart([{ ...line('A', 0), unitPricePaise: 200_001 }], promos, ctx({ tender: 'CASH' }));
    expect(r.applied[0]?.promoId).toBe('P-2K');
  });
  it('per-line allocations sum exactly to the discount (no lost paise)', () => {
    const r = priceCart([line('A', 333, 1), line('B', 777, 1), line('C', 999, 1)], [{ ...OVER2K, minPaise: 100_000 }, UPI], ctx({ tender: 'UPI' }));
    expect(r.lines.reduce((a, l) => a + l.discountPaise, 0)).toBe(r.discountPaise);
    for (const l of r.lines) expect(l.allocations.reduce((a, x) => a + x.amountPaise, 0)).toBe(l.discountPaise);
  });
  it('nudges "add ₹X to unlock" when close to the threshold', () => {
    const r = priceCart([line('A', 1700)], promos, ctx({ tender: 'CASH' }));
    expect(r.nudges.find((n) => n.promoId === 'P-2K')).toMatchObject({ remainingPaise: 30_001 });
  });
  it('service lines (gift wrap) never count toward offers', () => {
    const r = priceCart([line('A', 1900), line('GW', 200, 1, { isService: true, gstRate: 18 })], promos, ctx({ tender: 'CASH' }));
    expect(r.applied).toHaveLength(0);
  });
});

describe('Buy 2 Get 1', () => {
  const b2g1: BxGyPromo = { id: 'P-B2G1', name: 'Buy 2 Get 1 Free — Stationery', kind: 'bxgy', scope: { departmentIds: ['STA'] }, buyQty: 2, getQty: 1, discountPct: 100, priority: 20, stackable: true };
  const sta = (id: string, p: number, q = 1) => line(id, p, q, { departmentId: 'STA' });
  it('cheapest of three is free', () => {
    const r = priceCart([sta('X', 399), sta('Y', 199), sta('Z', 299)], [b2g1], ctx());
    expect(net(r)).toBe(399 + 299);
    expect(r.lines.find((l) => l.lineId === 'Y')!.netPaise).toBe(0);
  });
  it('works across quantity on one line; 5 units → only one free', () => {
    const r = priceCart([sta('X', 200, 5)], [b2g1], ctx());
    expect(net(r)).toBe(800);
  });
  it('6 units → two free; items outside the scope are untouched', () => {
    const r = priceCart([sta('X', 100, 6), line('P', 500)], [b2g1], ctx());
    expect(net(r)).toBe(400 + 500);
  });
  it('2 units → no discount but nudges to add one more', () => {
    const r = priceCart([sta('X', 100, 2)], [b2g1], ctx());
    expect(r.discountPaise).toBe(0);
    expect(r.nudges[0]).toMatchObject({ remainingQty: 1 });
  });
  it('50% off the third item variant', () => {
    const r = priceCart([sta('X', 100, 3)], [{ ...b2g1, discountPct: 50 }], ctx());
    expect(net(r)).toBe(250);
  });
});

describe('bundle price', () => {
  const bundle: BundlePromo = { id: 'P-BUN', name: 'Plush + Pouch @ ₹699', kind: 'bundle', items: [{ scope: { departmentIds: ['PLU'] }, qty: 1 }, { scope: { subCategoryIds: ['BG-PCH'] }, qty: 1 }], bundlePricePaise: 69_900, priority: 25, stackable: true };
  const plush = (p = 499) => line('PL', p, 1, { departmentId: 'PLU' });
  const pouch = (p = 399, q = 1) => line('PC', p, q, { departmentId: 'BAG', subCategoryId: 'BG-PCH' });
  it('prices a complete bundle', () => { expect(net(priceCart([plush(), pouch()], [bundle], ctx()))).toBe(699); });
  it('incomplete bundle gets no discount', () => { expect(priceCart([plush()], [bundle], ctx()).discountPaise).toBe(0); });
  it('two bundles; leftover unit full price', () => {
    const r = priceCart([line('PL', 499, 2, { departmentId: 'PLU' }), pouch(399, 3)], [bundle], ctx());
    expect(net(r)).toBe(2 * 699 + 399);
  });
  it('no discount when the bundle price is higher than the items', () => { expect(priceCart([plush(100), pouch(100)], [bundle], ctx()).discountPaise).toBe(0); });
});

describe('tiered spend', () => {
  const tiered: TieredPromo = { id: 'P-TIER', name: 'Stationery spend & save', kind: 'tiered', scope: { departmentIds: ['STA'] }, tiers: [{ minPaise: 50_000, pct: 5 }, { minPaise: 100_000, pct: 10 }, { minPaise: 150_000, pct: 15 }], priority: 40, stackable: true };
  const sta = (p: number) => line('S', p, 1, { departmentId: 'STA' });
  it('below first tier: nothing + nudge to the next tier', () => {
    const r = priceCart([sta(400)], [tiered], ctx());
    expect(r.discountPaise).toBe(0); expect(r.nudges[0]).toMatchObject({ remainingPaise: 10_000 });
  });
  it('picks the highest tier met', () => {
    expect(net(priceCart([sta(500)], [tiered], ctx()))).toBe(475);
    expect(net(priceCart([sta(1200)], [tiered], ctx()))).toBe(1080);
    expect(net(priceCart([sta(1600)], [tiered], ctx()))).toBe(1360);
  });
  it('only counts in-scope spend', () => { expect(priceCart([sta(400), line('P', 900)], [tiered], ctx()).discountPaise).toBe(0); });
});

describe('priority, stacking matrix, budgets', () => {
  const m10: MarkdownPromo = { id: 'P-MD', name: 'Plush 10% off', kind: 'markdown', scope: { departmentIds: ['PLU'] }, pct: 10, priority: 10, stackable: true };
  it('markdown then UPI compound in priority order', () => {
    const r = priceCart([line('A', 1000)], [UPI, m10], ctx({ tender: 'UPI' }));
    expect(r.applied.map((a) => a.promoId)).toEqual(['P-MD', 'P-UPI']);
    expect(net(r)).toBe(855);
  });
  it('a non-stackable promo competes with the stack and the better deal wins', () => {
    const flash: MarkdownPromo = { id: 'P-FLASH', name: 'Flash 30% off', kind: 'markdown', scope: {}, pct: 30, priority: 5, stackable: false };
    const r = priceCart([line('A', 1000)], [UPI, m10, flash], ctx({ tender: 'UPI' }));
    expect(r.applied.map((a) => a.promoId)).toEqual(['P-FLASH']);
    expect(r.rejected.some((x) => x.promoId === 'P-MD' || x.promoId === 'P-UPI')).toBe(false);
    const weak = priceCart([line('A', 1000)], [UPI, m10, { ...flash, pct: 5 }], ctx({ tender: 'UPI' }));
    expect(weak.applied.map((a) => a.promoId)).toEqual(['P-MD', 'P-UPI']);
    expect(weak.rejected.find((x) => x.promoId === 'P-FLASH')?.reason).toMatch(/Not stackable/);
  });
  it('exclusive group keeps only the best member', () => {
    const a: MarkdownPromo = { ...m10, id: 'A', pct: 10, exclusiveGroup: 'fest' }; const b: MarkdownPromo = { ...m10, id: 'B', pct: 20, exclusiveGroup: 'fest' };
    expect(priceCart([line('X', 1000)], [a, b], ctx()).applied.map((x) => x.promoId)).toEqual(['B']);
  });
  it('budget cap clips the discount and exhausted promos are skipped', () => {
    const r = priceCart([line('A', 1000)], [{ ...m10, budgetPaise: 5_000, budgetUsedPaise: 0 }], ctx());
    expect(r.discountPaise).toBe(5_000);
    const gone = priceCart([line('A', 1000)], [{ ...m10, budgetPaise: 5_000, budgetUsedPaise: 5_000 }], ctx());
    expect(gone.discountPaise).toBe(0); expect(gone.rejected[0]?.reason).toMatch(/Budget/);
  });
  it('validity window, store and channel filters', () => {
    expect(priceCart([line('A', 1000)], [{ ...m10, validTo: '2026-11-03' }], ctx()).discountPaise).toBe(0);
    expect(priceCart([line('A', 1000)], [{ ...m10, storeIds: ['MUM-PMC'] }], ctx()).discountPaise).toBe(0);
    expect(priceCart([line('A', 1000)], [{ ...m10, channels: ['web'] }], ctx()).discountPaise).toBe(0);
    expect(priceCart([line('A', 1000)], [{ ...m10, validFrom: '2026-11-04', validTo: '2026-11-04' }], ctx()).discountPaise).toBe(10_000);
  });
  it('draft promotions never apply', () => { expect(priceCart([line('A', 1000)], [{ ...m10, status: 'draft' }], ctx()).discountPaise).toBe(0); });
  it('loyalty tier + happy hour + free gift', () => {
    const loy: LoyaltyTierPromo = { id: 'P-LOY', name: 'Tier perk', kind: 'loyalty_tier', tierPcts: { BESTIE: 2, SEOULMATE: 4 }, priority: 60, stackable: true };
    expect(net(priceCart([line('A', 1000)], [loy], ctx({ customer: { id: 'c', tierId: 'SEOULMATE' } })))).toBe(960);
    expect(priceCart([line('A', 1000)], [loy], ctx({ customer: { id: 'c', tierId: 'CUTIE' } })).discountPaise).toBe(0);
    const hh: HappyHourPromo = { id: 'P-HH', name: 'Happy hour', kind: 'happy_hour', scope: {}, pct: 10, days: [3], fromHour: 15, toHour: 18, priority: 15, stackable: true };
    expect(net(priceCart([line('A', 1000)], [hh], ctx()))).toBe(900);                                // Wed 15:30 IST
    expect(priceCart([line('A', 1000)], [hh], ctx({ at: new Date('2026-11-04T13:00:00Z') })).discountPaise).toBe(0);   // 18:30 IST
    const gift: FreeGiftPromo = { id: 'P-GIFT', name: 'Free sticker', kind: 'free_gift', minPaise: 150_000, gift: { skuId: 'SKU-GIFT', name: 'Sticker sheet', mrpPaise: 19_900, gstRate: 12 }, priority: 70, stackable: true };
    const g = priceCart([line('A', 1500)], [gift], ctx());
    expect(g.lines.find((l) => l.isFreeGift)).toMatchObject({ netPaise: 0, qty: 1 }); expect(net(g)).toBe(1500);
    expect(priceCart([line('A', 1200)], [gift], ctx()).nudges[0]?.message).toMatch(/free Sticker sheet/);
  });
  it('manual manager discount applies first and is capped at the line value', () => {
    const r = priceCart([line('A', 1000, 1, { manualDiscountPaise: 20_000, manualReasonCode: 'RC-DISC-MGR' })], [UPI], ctx({ tender: 'UPI' }));
    expect(net(r)).toBe(760);
    expect(net(priceCart([line('A', 100, 1, { manualDiscountPaise: 999_999 })], [], ctx()))).toBe(0);
  });
});

describe('vouchers', () => {
  const V: Voucher = { code: 'WEL-0001', valuePaise: 10_000, minSpendPaise: 59_900, usage: 'single', perCustomerLimit: 1, validFrom: '2026-01-01', validTo: '2026-12-31', channel: 'All' };
  const at = AT;
  const chk = (v: Voucher, n = 100_000, o: { customerId?: string; channel?: 'store' | 'web' } = {}) => checkVoucher(v, { netPaise: n, customerId: o.customerId ?? 'c1', channel: o.channel ?? 'store', at });
  it('valid voucher gives its value', () => { expect(chk(V)).toEqual({ ok: true, discountPaise: 10_000 }); });
  it('minimum spend', () => { expect(chk(V, 50_000)).toMatchObject({ ok: false, reason: expect.stringMatching(/Minimum spend ₹599/) }); });
  it('validity window', () => {
    expect(chk({ ...V, validTo: '2026-11-03' })).toMatchObject({ ok: false, reason: 'Voucher has expired' });
    expect(chk({ ...V, validFrom: '2026-11-05' })).toMatchObject({ ok: false, reason: 'Voucher is not valid yet' });
  });
  it('single-use and void/redeemed', () => {
    expect(chk({ ...V, redemptionCount: 1 })).toMatchObject({ ok: false, reason: 'Voucher already redeemed' });
    expect(chk({ ...V, status: 'redeemed' }).ok).toBe(false); expect(chk({ ...V, status: 'void' }).ok).toBe(false);
  });
  it('per-customer limit on multi-use vouchers', () => {
    const multi: Voucher = { ...V, usage: 'multi', perCustomerLimit: 2, redeemedByCustomer: { c1: 2, c2: 1 } };
    expect(chk(multi, 100_000, { customerId: 'c1' })).toMatchObject({ ok: false, reason: expect.stringMatching(/per customer/) });
    expect(chk(multi, 100_000, { customerId: 'c2' }).ok).toBe(true);
  });
  it('global redemption cap, channel, assigned customer', () => {
    expect(chk({ ...V, usage: 'multi', maxRedemptions: 100, redemptionCount: 100 }).ok).toBe(false);
    expect(chk({ ...V, channel: 'Web' }).ok).toBe(false); expect(chk({ ...V, channel: 'Store' }, 100_000, { channel: 'web' }).ok).toBe(false);
    expect(chk({ ...V, customerId: 'c9' })).toMatchObject({ ok: false });
  });
  it('percentage voucher with cap, never exceeding the bill', () => {
    expect(chk({ ...V, valuePaise: undefined, percentOff: 10, maxDiscountPaise: 5_000 }, 100_000)).toEqual({ ok: true, discountPaise: 5_000 });
    expect(chk({ ...V, valuePaise: 500_000, minSpendPaise: 0 }, 100_000)).toEqual({ ok: true, discountPaise: 100_000 });
  });
  it('applies inside pricing, stacks before the UPI offer, and reports errors without throwing', () => {
    const r = priceCart([line('A', 1000)], [UPI], ctx({ tender: 'UPI', voucher: V, customerLike: undefined } as never));
    expect(r.applied.map((a) => a.promoId)).toEqual(['voucher-WEL-0001', 'P-UPI']);
    expect(net(r)).toBe((1000 - 100) * 0.95);
    const bad = priceCart([line('A', 300)], [], ctx({ voucher: V }));
    expect(bad.voucherError).toMatch(/Minimum spend/); expect(bad.discountPaise).toBe(0);
  });
  it('non-combinable voucher competes with promotions', () => {
    const solo = { ...V, combinable: false, valuePaise: 50_000 };
    const r = priceCart([line('A', 1000)], [UPI], ctx({ tender: 'UPI', voucher: solo }));
    expect(r.applied.map((a) => a.promoId)).toEqual(['voucher-WEL-0001']);
    expect(net(r)).toBe(500);
    const tiny = priceCart([line('A', 1000)], [UPI], ctx({ tender: 'UPI', voucher: { ...solo, valuePaise: 1_000 } }));
    expect(tiny.applied.map((a) => a.promoId)).toEqual(['P-UPI']); expect(tiny.voucherError).toMatch(/cannot be combined/);
  });
});

describe('gift cards, credit notes, loyalty', () => {
  it('partial redemption: card smaller than the bill', () => {
    const r = redeemBalance('GC', 'GC-1', 30_000, 85_500);
    expect(r).toMatchObject({ appliedPaise: 30_000, balanceAfterPaise: 0 });
  });
  it('partial redemption: bill smaller than the card leaves a balance', () => {
    const r = redeemBalance('GC', 'GC-1', 100_000, 64_900);
    expect(r).toMatchObject({ appliedPaise: 64_900, balanceAfterPaise: 35_100 });
    expect(redeemBalance('GC', 'GC-1', 100_000, 0).appliedPaise).toBe(0);
  });
  it('rejects blocked / expired / empty cards', () => {
    expect(checkGiftCard({ id: 'g', balancePaise: 1, status: 'blocked' }, AT)).toMatchObject({ ok: false });
    expect(checkGiftCard({ id: 'g', balancePaise: 1, expiresAt: '2026-11-03' }, AT)).toMatchObject({ ok: false, reason: 'Gift card has expired' });
    expect(checkGiftCard({ id: 'g', balancePaise: 0 }, AT)).toMatchObject({ ok: false });
    expect(checkGiftCard({ id: 'g', balancePaise: 5_000, expiresAt: '2026-11-04' }, AT)).toEqual({ ok: true, usablePaise: 5_000 });
  });
  it('top-up respects the balance cap', () => {
    expect(topUpGiftCard({ id: 'g', balancePaise: 50_000 }, 25_000, AT)).toEqual({ ok: true, balancePaise: 75_000 });
    expect(topUpGiftCard({ id: 'g', balancePaise: 950_000 }, 100_000, AT)).toMatchObject({ ok: false });
    expect(topUpGiftCard({ id: 'g', balancePaise: 0, status: 'void' }, 100, AT)).toMatchObject({ ok: false });
  });
  it('points: 1pt = ₹1, ≤50% of bill, min 50', () => {
    expect(redeemPoints(500, 100, 100_000)).toEqual({ ok: true, points: 100, valuePaise: 10_000 });
    expect(redeemPoints(900, 900, 100_000)).toEqual({ ok: true, points: 500, valuePaise: 50_000 });
    expect(redeemPoints(500, 20, 100_000)).toMatchObject({ ok: false });
    expect(redeemPoints(40, 100, 100_000)).toMatchObject({ ok: false });
  });
  it('earn scales with tier; tier by annual spend', () => {
    expect(earnPoints(200_000, { earnRatePct: 5 })).toBe(20); expect(earnPoints(200_000, { earnRatePct: 10 })).toBe(40); expect(earnPoints(9_999)).toBe(0);
    const tiers = [{ id: 'CUTIE', minSpendPaise: 0, earnRatePct: 5 }, { id: 'BESTIE', minSpendPaise: 1_500_000, earnRatePct: 7 }, { id: 'SEOULMATE', minSpendPaise: 4_000_000, earnRatePct: 10 }];
    expect(tierFor(1_600_000, tiers)?.id).toBe('BESTIE'); expect(tierFor(10, tiers)?.id).toBe('CUTIE');
  });
});

describe('invoice, journal, returns, Z-report', () => {
  const priced = priceCart([line('A', 999, 1, { gstRate: 12 }), line('B', 499, 2, { gstRate: 18 })], [OVER2K, UPI].map((p) => ({ ...p, minPaise: 100_000 }) as Promotion), ctx({ tender: 'UPI' }));
  const inv = buildInvoice(priced.lines, true);
  it('splits tax out of the discounted inclusive price and rounds off to the rupee', () => {
    for (const l of inv.lines) expect(l.taxablePaise + l.cgstPaise + l.sgstPaise).toBe(l.netPaise);
    expect(inv.taxablePaise + inv.totalTaxPaise).toBe(inv.netPaise);
    expect(inv.payablePaise % 100).toBe(0); expect(Math.abs(inv.roundOffPaise)).toBeLessThan(100);
    expect(inv.taxSummary.map((r) => r.gstRate)).toEqual([12, 18]);
  });
  it('inter-state supplies carry IGST only', () => {
    const i = buildInvoice(priced.lines, false); expect(i.cgstPaise + i.sgstPaise).toBe(0); expect(i.igstPaise).toBe(i.totalTaxPaise);
  });
  it('journal balances (with split tenders) and its reversal balances too', () => {
    const j = buildSaleJournal(inv, [{ mode: 'GC', amountPaise: 30_000 }, { mode: 'UPI', amountPaise: inv.payablePaise - 30_000 }], 80_000);
    expect(journalBalanced(j)).toBe(true); expect(journalBalanced(reverseJournal(j))).toBe(true);
    expect(j.find((l) => l.ledgerId === 'L-GC-LIAB')?.drPaise).toBe(30_000);
  });
  it('refund pro-rata, final unit takes the remainder', () => {
    const a = refundForQty({ lineNetPaise: 1000, soldQty: 3, returnedQty: 0, refundedPaise: 0, qty: 1 });
    const b = refundForQty({ lineNetPaise: 1000, soldQty: 3, returnedQty: 1, refundedPaise: a, qty: 1 });
    const c = refundForQty({ lineNetPaise: 1000, soldQty: 3, returnedQty: 2, refundedPaise: a + b, qty: 1 });
    expect(a + b + c).toBe(1000);
    expect(() => refundForQty({ lineNetPaise: 1000, soldQty: 3, returnedQty: 3, refundedPaise: 1000, qty: 1 })).toThrow();
  });
  it('Z-report: expected cash, change given, cash refunds, variance', () => {
    const z = zReport({
      openingFloatPaise: 200_000,
      sales: [{ totals: [{ mode: 'CASH', amountPaise: 100_000 }], netPaise: 90_000, discountPaise: 5_000, taxPaise: 9_000, changeGivenPaise: 10_000 }, { totals: [{ mode: 'UPI', amountPaise: 50_000 }], netPaise: 50_000, discountPaise: 0, taxPaise: 5_000, changeGivenPaise: 0 }, { totals: [{ mode: 'CASH', amountPaise: 99_900 }], netPaise: 1, discountPaise: 0, taxPaise: 0, changeGivenPaise: 0, voided: true }],
      returns: [{ refundPaise: 20_000, mode: 'CASH' }, { refundPaise: 10_000, mode: 'CN' }], countedCashPaise: 265_000,
    });
    expect(z).toMatchObject({ billCount: 2, cashSalesPaise: 90_000, cashRefundsPaise: 20_000, expectedCashPaise: 270_000, variancePaise: -5_000, returnsPaise: 30_000 });
    expect(z.byTender).toEqual({ CASH: 90_000, UPI: 50_000 });
  });
  it('denomination count', () => { expect(countDenominations({ 500: 2, 100: 3, 10: 5, 1: 7 })).toBe((1000 + 300 + 50 + 7) * 100); });
});

describe('UPI + mock gateway + cross-sell', () => {
  it('builds a valid dynamic-QR intent URL', () => {
    const u = upiIntentUrl({ vpa: 'texafashions@mockbank', payee: 'Texa Fashions India', amountPaise: 270_750, ref: 'INV123' });
    expect(u).toMatch(/^upi:\/\/pay\?/); expect(u).toContain('pa=texafashions%40mockbank'); expect(u).toContain('am=2707.50'); expect(u).toContain('pn=Texa%20Fashions%20India');
  });
  it('mock gateway auto-confirms and can be cancelled', async () => {
    const g = new MockPaymentGateway({ autoConfirmMs: 200 });
    const i = g.createUpiIntent(10_000, 'T-1');
    expect((await g.waitForPayment(i)).utr).toMatch(/^MOCK/);
    const sig = { cancelled: false }; const p = g.waitForPayment(g.createUpiIntent(1, 'T-2'), sig); sig.cancelled = true;
    await expect(p).rejects.toThrow(/cancelled/);
  });
  it('cross-sell suggests same-character items from other departments', () => {
    const cat = [{ skuId: 'a', name: 'Bear plush', pricePaise: 49900, character: 'Bear', departmentId: 'PLU' }, { skuId: 'b', name: 'Bear pouch', pricePaise: 29900, character: 'Bear', departmentId: 'BAG' }, { skuId: 'c', name: 'Cat pen', pricePaise: 19900, character: 'Cat', departmentId: 'STA' }];
    expect(crossSell([cat[0]!], cat).map((s) => s.skuId)).toEqual(['b']);
  });
});

import { buildReturnJournal } from './index';
describe('return journal', () => {
  it('balances, restocks at cost, damaged goes to shrinkage', () => {
    const j = buildReturnJournal([{ refundPaise: 11_200, gstRate: 12, intraState: true, restockCostPaise: 4_000 }, { refundPaise: 5_900, gstRate: 18, intraState: true, restockCostPaise: 2_000, damaged: true }], [{ mode: 'CASH', amountPaise: 10_000 }, { mode: 'CN', amountPaise: 7_100 }]);
    expect(journalBalanced(j)).toBe(true);
    expect(j.find((l) => l.ledgerId === 'L-INV')?.drPaise).toBe(4_000); expect(j.find((l) => l.ledgerId === 'L-SHRINK')?.drPaise).toBe(2_000);
    expect(j.find((l) => l.ledgerId === 'L-CN-LIAB')?.crPaise).toBe(7_100);
  });
});
