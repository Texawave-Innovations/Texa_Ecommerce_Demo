import type { z } from 'zod';
import { SERVICE_GIFTWRAP_SKU, type CompleteSaleInput as CompleteSaleSchema } from '@texafashions/types';
import {
  buildInvoice, buildSaleJournal, checkCreditNote, checkGiftCard, earnPoints, journalBalanced, pointsExpiry, priceCart, redeemBalance, redeemPoints, tierFor,
  type CartLine, type Promotion, type TenderKind, type TierDef, type Voucher,
} from '@texafashions/domain';
import { FieldValue, Timestamp, col, db, type Caller } from '../admin';
import { StockEngine, audit, fail, getMasterDocs, must, requireLocation, requireRoles, reserveNumber, ymd } from '../engine';
import { requireManagerPin } from './pin';
import { queueEBill } from './ebill';
import { plain } from './util';
import { gst } from '../adapters/gst';

type Doc = Record<string, any>;
type Input = z.output<typeof CompleteSaleSchema>;
export interface OfflineOpts { provisionalNo: string; at: Date; clientTotalPaise: number }
const INSTRUMENTS = ['GC', 'CN', 'POINTS'];
const rupee = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

/** The authoritative sale: re-prices from master data (never trusts client prices), settles tenders, moves stock, posts journal — one transaction. */
export async function completeSaleCore(c: Caller, input: Input, opts: { offline?: OfflineOpts } = {}): Promise<Doc> {
  requireRoles(c, 'cashier', 'store_manager'); requireLocation(c, input.storeId);
  const offline = opts.offline; const at = offline?.at ?? new Date();
  const saleRef = col('sales').doc(input.clientSaleId);

  const skuIds = [...new Set(input.lines.map((l) => l.skuId))];
  const manual = input.lines.filter((l) => (l.manualDiscountPaise ?? 0) > 0);
  const [skus, storeSnap, promoSnap, tierSnap, reasons] = await Promise.all([
    getMasterDocs<Doc>('skus', skuIds), col('stores').doc(input.storeId).get(), col('promotions').where('status', '==', 'active').get(), col('customerTiers').get(),
    getMasterDocs<Doc>('reasonCodes', manual.map((l) => l.manualReasonCode ?? '')),
  ]);
  const store = must(storeSnap.data() as Doc | undefined, `Unknown store ${input.storeId}`);
  const gstin = store.gstinId ? (await col('gstins').doc(store.gstinId).get()).data() as Doc | undefined : undefined;
  const promos = promoSnap.docs.map((d) => ({ ...(d.data() as Doc), id: d.id }) as Promotion);
  const tiers: TierDef[] = tierSnap.docs.map((d) => ({ id: d.id, minSpendPaise: d.get('minSpendPaise') ?? 0, earnRatePct: d.get('earnRatePct') ?? 5 }));

  let approver: { id: string; name: string } | undefined;
  if (manual.length) {
    for (const l of manual) { const r = reasons.get(l.manualReasonCode ?? ''); if (!r || r.context !== 'discount_override') fail(`Manual discount needs a discount_override reason code (line ${l.lineId})`); }
    approver = offline ? { id: 'offline-unverified', name: 'Offline (unverified)' } : await requireManagerPin(input.storeId, input.managerPin);
  }
  const cartLines: CartLine[] = input.lines.map((l) => {
    const s = must(skus.get(l.skuId), `Unknown SKU ${l.skuId}`);
    const svc = !!s.isService || l.skuId === SERVICE_GIFTWRAP_SKU;
    return { lineId: l.lineId, skuId: l.skuId, name: s.name, qty: l.qty, unitPricePaise: s.pricePaise, mrpPaise: s.mrpPaise, gstRate: Number(s.gstRate ?? 0), hsn: s.hsn, departmentId: s.departmentId, categoryId: s.categoryId, subCategoryId: s.subCategoryId, brandId: s.brandId, isService: svc, noDiscount: svc, manualDiscountPaise: l.manualDiscountPaise ?? undefined, manualReasonCode: l.manualReasonCode ?? undefined };
  });
  // Tender used for pricing: UPI iff every cash-like payment is UPI; same rule as the POS UI.
  const cashLike = [...new Set(input.payments.filter((p) => !INSTRUMENTS.includes(p.mode)).map((p) => p.mode))];
  const tender: TenderKind | undefined = cashLike.length === 1 ? (cashLike[0] as TenderKind) : undefined;
  const voucherRef = input.voucherCode ? col('vouchers').doc(input.voucherCode.trim().toUpperCase()) : null;
  const instrRefs = input.payments.filter((p) => p.mode === 'GC' || p.mode === 'CN').map((p) => ({ p, ref: col(p.mode === 'GC' ? 'giftCards' : 'creditNotes').doc(must(p.ref, `${p.mode} reference missing`)) }));
  const custRef = input.customerId ? col('customers').doc(input.customerId) : null;
  const jRef = col('journals').doc();

  const out = await db.runTransaction(async (tx) => {
    const reads = await tx.getAll(saleRef, col('shifts').doc(input.shiftId), ...(custRef ? [custRef] : []), ...(voucherRef ? [voucherRef] : []), ...instrRefs.map((i) => i.ref));
    let k = 0;
    const existing = reads[k++]!; const shiftSnap = reads[k++]!; const custSnap = custRef ? reads[k++]! : null; const vSnap = voucherRef ? reads[k++]! : null;
    const instrSnaps = new Map(instrRefs.map((i) => [i.ref.path, reads[k++]!]));
    if (existing.exists) { const s = existing.data() as Doc; return { sale: plain<Doc>({ ...s, id: existing.id }), pointsBalance: custSnap?.get('pointsBalance') ?? 0, cust: undefined as Doc | undefined, fresh: false }; }
    const shift = must(shiftSnap.data() as Doc | undefined, 'Shift not found');
    if (shift.status !== 'open' || shift.tillId !== input.tillId || shift.storeId !== input.storeId) fail('Shift is not open on this till');
    const cust = custSnap?.exists ? (custSnap.data() as Doc) : undefined;
    if (input.customerId && !cust) fail(`Unknown customer ${input.customerId}`);
    const voucher: Voucher | null = vSnap ? (vSnap.exists ? ({ ...(vSnap.data() as Doc), code: vSnap.id } as Voucher) : (fail(`Unknown voucher ${input.voucherCode}`))) : null;

    const priced = priceCart(cartLines, promos, { channel: 'store', storeId: input.storeId, at, customer: cust ? { id: input.customerId!, tierId: cust.tierId } : null, tender, voucher });
    if (input.voucherCode && priced.voucherError) fail(priced.voucherError);
    const inv = buildInvoice(priced.lines, true /* B2C store sale: supplied in the store's own state */);
    const num = await reserveNumber(tx, 'INV', input.storeId);
    const eng = await StockEngine.load(tx, priced.lines.filter((l) => !l.isService).map((l) => [input.storeId, l.skuId] as [string, string]), { ignoreLock: true });

    // ── settle instruments (partial redemption), then cash-like tenders
    let due = inv.payablePaise;
    const payments: Doc[] = []; const tenders: { mode: string; amountPaise: number }[] = [];
    const instrWrites: (() => void)[] = []; let pointsRedeemed = 0;
    for (const p of input.payments) {
      if (p.mode === 'GC' || p.mode === 'CN') {
        const snap = must(instrSnaps.get(col(p.mode === 'GC' ? 'giftCards' : 'creditNotes').doc(p.ref!).path), `${p.mode} ${p.ref} not found`);
        if (!snap.exists) fail(`${p.mode === 'GC' ? 'Gift card' : 'Credit note'} ${p.ref} not found`);
        const d = snap.data() as Doc; const chk = p.mode === 'GC' ? checkGiftCard({ id: snap.id, ...d } as never, at) : checkCreditNote({ id: snap.id, ...d } as never, at, input.customerId ?? undefined);
        if (!chk.ok) fail(chk.reason);
        const r = redeemBalance(p.mode, snap.id, d.balancePaise, Math.min(p.amountPaise, due));
        if (r.appliedPaise <= 0) continue;
        due -= r.appliedPaise; payments.push({ mode: p.mode, amountPaise: r.appliedPaise, ref: snap.id }); tenders.push({ mode: p.mode, amountPaise: r.appliedPaise });
        instrWrites.push(() => {
          tx.update(snap.ref, { balancePaise: r.balanceAfterPaise, ...(p.mode === 'CN' && r.balanceAfterPaise === 0 ? { status: 'used' } : {}), updatedAt: FieldValue.serverTimestamp() });
          if (p.mode === 'GC') tx.set(snap.ref.collection('txns').doc(), { kind: 'redeem', amountPaise: -r.appliedPaise, balanceAfterPaise: r.balanceAfterPaise, saleId: saleRef.id, storeId: input.storeId, at: FieldValue.serverTimestamp() });
        });
      } else if (p.mode === 'POINTS') {
        if (!cust) fail('Select a customer to redeem points');
        const r = redeemPoints(cust.pointsBalance ?? 0, p.points ?? Math.floor(p.amountPaise / 100), due);
        if (!r.ok) fail(r.reason);
        due -= r.valuePaise; pointsRedeemed += r.points; payments.push({ mode: 'POINTS', amountPaise: r.valuePaise, points: r.points }); tenders.push({ mode: 'POINTS', amountPaise: r.valuePaise });
      }
    }
    const nonCash = input.payments.filter((p) => p.mode === 'UPI' || p.mode === 'CARD');
    const nonCashTotal = nonCash.reduce((a, p) => a + p.amountPaise, 0);
    if (nonCashTotal > due) fail(`Card/UPI amount ${rupee(nonCashTotal)} exceeds the amount due ${rupee(due)}`);
    const cashTendered = input.payments.filter((p) => p.mode === 'CASH').reduce((a, p) => a + p.amountPaise, 0);
    const cashNeeded = due - nonCashTotal; let needsReview = false;
    if (cashTendered < cashNeeded) {
      if (!offline) fail(`Tendered amount is ${rupee(cashNeeded - cashTendered)} short of the payable ${rupee(inv.payablePaise)} — price changed, please re-price the cart and collect again`);
      needsReview = true;
    }
    const change = Math.max(0, cashTendered - cashNeeded);
    for (const p of nonCash) { payments.push({ mode: p.mode, amountPaise: p.amountPaise, ref: p.ref ?? null }); tenders.push({ mode: p.mode, amountPaise: p.amountPaise }); }
    if (cashTendered) { payments.push({ mode: 'CASH', amountPaise: cashTendered }); tenders.push({ mode: 'CASH', amountPaise: cashTendered - change }); }

    // ── stock
    let cogs = 0; const unitCost = new Map<string, number>();
    for (const l of priced.lines) {
      if (l.isService) { unitCost.set(l.lineId, 0); continue; }
      const cost = eng.move({ locationId: input.storeId, skuId: l.skuId, bucket: 'onHand', qty: -l.qty, kind: 'issue', refType: 'sale', refId: saleRef.id, reason: 'POS sale', allowNegative: true, at: offline ? at : undefined });
      unitCost.set(l.lineId, cost); cogs += cost * l.qty;
    }
    const negativeStock = priced.lines.some((l) => !l.isService && eng.get(input.storeId, l.skuId).onHand < 0);

    // ── loyalty
    const tier = cust ? tiers.find((t) => t.id === cust.tierId) : undefined;
    const pointsEarned = cust ? earnPoints(inv.payablePaise - tenders.filter((t) => t.mode === 'POINTS').reduce((a, t) => a + t.amountPaise, 0), tier) : 0;
    const pointsBalance = cust ? (cust.pointsBalance ?? 0) - pointsRedeemed + pointsEarned : 0;

    const journal = buildSaleJournal(inv, tenders, cogs);
    if (!journalBalanced(journal)) fail('Internal error: sale journal does not balance');
    const day = ymd(at);
    const variancePaise = offline ? inv.payablePaise - offline.clientTotalPaise : undefined;
    if (offline && variancePaise !== 0) needsReview = true;
    if (approver?.id === 'offline-unverified') needsReview = true;
    const einvoice = gstin?.gstin ? await gst.generateEInvoice({ gstin: gstin.gstin, invoiceNo: num.number, invoiceDate: day, payablePaise: inv.payablePaise }) : null;

    const sale: Doc = {
      invoiceNo: num.number, provisionalNo: offline?.provisionalNo ?? null, source: offline ? 'offline' : 'online', storeId: input.storeId, storeName: store.name, storeGstin: gstin?.gstin ?? null, einvoice,
      tillId: input.tillId, shiftId: input.shiftId, cashierId: c.uid, cashierName: c.name,
      customer: cust ? { id: input.customerId, name: cust.name, mobile: cust.mobile, tierId: cust.tierId ?? null } : null,
      lines: inv.lines.map((l, i) => { const pl = priced.lines[i]!; return { lineId: l.lineId, skuId: l.skuId, name: l.name, hsn: l.hsn ?? null, qty: l.qty, gstRate: l.gstRate, grossPaise: l.grossPaise, discountPaise: l.discountPaise, netPaise: l.netPaise, taxablePaise: l.taxablePaise, cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise, unitCostPaise: unitCost.get(l.lineId) ?? 0, returnedQty: 0, refundedPaise: 0, isFreeGift: !!pl.isFreeGift, isService: !!pl.isService, allocations: pl.allocations }; }),
      applied: priced.applied.map((a) => ({ promoId: a.promoId, name: a.name, kind: a.kind, amountPaise: a.amountPaise, detail: a.detail ?? null })),
      taxSummary: inv.taxSummary, grossPaise: inv.grossPaise, discountPaise: inv.discountPaise, netPaise: inv.netPaise, taxablePaise: inv.taxablePaise, totalTaxPaise: inv.totalTaxPaise, roundOffPaise: inv.roundOffPaise, payablePaise: inv.payablePaise,
      payments, changeGivenPaise: change, pointsEarned, pointsRedeemed, voucherCode: voucher?.code ?? null,
      overrides: manual.map((l) => ({ lineId: l.lineId, amountPaise: priced.lines.find((x) => x.lineId === l.lineId)?.allocations.filter((a) => a.promoId.startsWith('manual-')).reduce((a, x) => a + x.amountPaise, 0) ?? 0, reasonCode: l.manualReasonCode ?? null, approvedBy: approver!.name })),
      status: 'completed', billQr: `INV|${saleRef.id}`, negativeStock, needsReview, variancePaise: variancePaise ?? null, notes: input.notes ?? null, journalId: jRef.id,
      createdAt: Timestamp.fromDate(at), createdAtServer: FieldValue.serverTimestamp(),
    };

    num.write();
    tx.set(saleRef, sale);
    tx.set(jRef, { event: 'sale', refType: 'sale', refId: saleRef.id, storeId: input.storeId, day, lines: journal, balanced: true, at: Timestamp.fromDate(at) });
    eng.commit(tx, c);
    instrWrites.forEach((w) => w());
    if (voucher) {
      const key = input.customerId ?? 'anonymous'; const count = (voucher.redemptionCount ?? 0) + 1;
      tx.set(vSnap!.ref, { redemptionCount: FieldValue.increment(1), redeemedByCustomer: { [key]: FieldValue.increment(1) }, ...(voucher.usage === 'single' || (voucher.maxRedemptions !== undefined && count >= voucher.maxRedemptions) ? { status: 'redeemed' } : {}), lastRedeemedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    for (const a of priced.applied) { const p = promos.find((x) => x.id === a.promoId); if (p?.budgetPaise !== undefined) tx.update(col('promotions').doc(p.id), { budgetUsedPaise: FieldValue.increment(a.amountPaise) }); }
    if (cust && custRef) {
      const lifetime = (cust.lifetimeSpendPaise ?? tier?.minSpendPaise ?? 0) + inv.payablePaise;
      const best = tierFor(lifetime, tiers); const upgrade = best && (!tier || best.minSpendPaise > tier.minSpendPaise) ? best.id : undefined;
      tx.update(custRef, { pointsBalance, lifetimeSpendPaise: lifetime, lastPurchaseAt: Timestamp.fromDate(at), ...(upgrade ? { tierId: upgrade } : {}) });
      if (pointsEarned) tx.set(col('loyaltyLedger').doc(), { customerId: input.customerId, kind: 'earn', points: pointsEarned, saleId: saleRef.id, storeId: input.storeId, expiresAt: Timestamp.fromDate(pointsExpiry(at)), at: Timestamp.fromDate(at) });
      if (pointsRedeemed) tx.set(col('loyaltyLedger').doc(), { customerId: input.customerId, kind: 'burn', points: -pointsRedeemed, saleId: saleRef.id, storeId: input.storeId, at: Timestamp.fromDate(at) });
    }
    tx.set(col('salesDailyShards').doc(`${input.storeId}_${day}_${Math.floor(Math.random() * 10)}`), { storeId: input.storeId, day, count: FieldValue.increment(1), netPaise: FieldValue.increment(inv.payablePaise), discountPaise: FieldValue.increment(inv.discountPaise) }, { merge: true });
    audit(tx, c, { action: 'sale_complete', entity: 'sales', entityId: saleRef.id, before: null, after: { invoiceNo: num.number, payablePaise: inv.payablePaise, source: offline ? 'offline' : 'online', needsReview } });
    for (const o of sale.overrides as Doc[]) audit(tx, c, { action: 'price_override', entity: 'sales', entityId: saleRef.id, before: null, after: { ...o } });
    return { sale: plain<Doc>({ ...sale, id: saleRef.id, createdAt: Timestamp.fromDate(at), createdAtServer: undefined }), pointsBalance, cust, fresh: true };
  });
  if (out.fresh) await queueEBill(out.sale, out.cust);
  return { ...out.sale, pointsBalance: out.pointsBalance };
}
