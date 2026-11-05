/** POS helpers: Z-report maths, provisional receipt numbers, e-bill template, UPI intent, mock payment gateway, cross-sell stub. Pure. */
import { formatINR } from './money';

// ───────── Z-report
export const INR_DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const;
export type DenominationCounts = Partial<Record<(typeof INR_DENOMINATIONS)[number], number>>;
export const countDenominations = (c: DenominationCounts): number => INR_DENOMINATIONS.reduce((a, d) => a + d * 100 * Math.max(0, Math.floor(c[d] ?? 0)), 0);

export interface ZInput {
  openingFloatPaise: number;
  sales: { totals: { mode: string; amountPaise: number }[]; netPaise: number; discountPaise: number; taxPaise: number; changeGivenPaise: number; voided?: boolean }[];
  returns: { refundPaise: number; mode: 'CASH' | 'CN' | 'ORIGINAL' | string }[];
  paidInPaise?: number; paidOutPaise?: number; countedCashPaise: number;
}
export interface ZReportTotals {
  billCount: number; grossSalesPaise: number; discountPaise: number; taxPaise: number; returnsPaise: number; netSalesPaise: number;
  byTender: Record<string, number>; cashSalesPaise: number; cashRefundsPaise: number; expectedCashPaise: number; countedCashPaise: number; variancePaise: number;
}
/** Expected drawer = float + cash tendered − change given − cash refunds + paid-in − paid-out. Voided bills are excluded (they reverse). */
export function zReport(i: ZInput): ZReportTotals {
  const live = i.sales.filter((s) => !s.voided);
  const byTender: Record<string, number> = {};
  for (const s of live) for (const t of s.totals) byTender[t.mode] = (byTender[t.mode] ?? 0) + t.amountPaise;
  const change = live.reduce((a, s) => a + s.changeGivenPaise, 0);
  const cashSales = (byTender.CASH ?? 0) - change;
  const cashRefunds = i.returns.filter((r) => r.mode === 'CASH').reduce((a, r) => a + r.refundPaise, 0);
  const returns = i.returns.reduce((a, r) => a + r.refundPaise, 0);
  const expected = i.openingFloatPaise + cashSales - cashRefunds + (i.paidInPaise ?? 0) - (i.paidOutPaise ?? 0);
  const net = live.reduce((a, s) => a + s.netPaise, 0);
  return {
    billCount: live.length, grossSalesPaise: net + live.reduce((a, s) => a + s.discountPaise, 0), discountPaise: live.reduce((a, s) => a + s.discountPaise, 0), taxPaise: live.reduce((a, s) => a + s.taxPaise, 0),
    returnsPaise: returns, netSalesPaise: net - returns, byTender: { ...byTender, ...(byTender.CASH !== undefined ? { CASH: cashSales } : {}) }, cashSalesPaise: cashSales, cashRefundsPaise: cashRefunds,
    expectedCashPaise: expected, countedCashPaise: i.countedCashPaise, variancePaise: i.countedCashPaise - expected,
  };
}
/** Variance beyond this needs a manager's sign-off to close the shift. */
export const Z_VARIANCE_TOLERANCE_PAISE = 10_000;

// ───────── numbering
/** Provisional receipt for sales taken offline: PRV/<till>/<yymmdd>/<seq>. Replaced by the real invoice number on sync. */
export const provisionalNo = (tillId: string, seq: number, at = new Date()) => {
  const t = new Date(at.getTime() + 5.5 * 3600_000).toISOString().slice(2, 10).replace(/-/g, '');
  return `PRV/${tillId}/${t}/${String(seq).padStart(4, '0')}`;
};
export const isProvisionalNo = (n: string | undefined | null) => !!n && n.startsWith('PRV/');

// ───────── e-bill (mock WhatsApp)
export interface EBillInput { customerName?: string; invoiceNo: string; storeName: string; totalPaise: number; savedPaise: number; pointsEarned?: number; link: string }
export function renderEBill(b: EBillInput): string {
  return [
    `Hi ${b.customerName?.split(' ')[0] ?? 'there'}! 🐻 Thanks for shopping at Texa Fashions ${b.storeName}.`,
    `Bill ${b.invoiceNo} · ${formatINR(b.totalPaise)}`,
    b.savedPaise > 0 ? `You saved ${formatINR(b.savedPaise)} today 🎉` : '',
    b.pointsEarned ? `+${b.pointsEarned} Uni Points added ✨` : '',
    `View your GST invoice: ${b.link}`,
  ].filter(Boolean).join('\n');
}

// ───────── UPI + mock gateway (Payment adapter; real PSP lands behind the same interface)
export function upiIntentUrl(o: { vpa: string; payee: string; amountPaise: number; ref: string; note?: string }): string {
  const q = new URLSearchParams({ pa: o.vpa, pn: o.payee, am: (o.amountPaise / 100).toFixed(2), tr: o.ref, tn: o.note ?? `Texa Fashions ${o.ref}`, cu: 'INR' });
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}
export interface PaymentIntent { ref: string; amountPaise: number; upiUrl: string; createdAt: number }
export interface PaymentGateway {
  createUpiIntent(amountPaise: number, ref: string): PaymentIntent;
  /** Resolves when the customer has paid (mock: after `autoConfirmMs`). Rejects on cancel/timeout. */
  waitForPayment(intent: PaymentIntent, signal?: { cancelled: boolean }): Promise<{ utr: string; paidAt: number }>;
}
export class MockPaymentGateway implements PaymentGateway {
  constructor(private o: { vpa?: string; payee?: string; autoConfirmMs?: number } = {}) {}
  createUpiIntent(amountPaise: number, ref: string): PaymentIntent {
    return { ref, amountPaise, createdAt: Date.now(), upiUrl: upiIntentUrl({ vpa: this.o.vpa ?? 'texafashions@mockbank', payee: this.o.payee ?? 'Texa Fashions India', amountPaise, ref }) };
  }
  waitForPayment(intent: PaymentIntent, signal?: { cancelled: boolean }): Promise<{ utr: string; paidAt: number }> {
    const ms = this.o.autoConfirmMs ?? 4000;
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        if (signal?.cancelled) return reject(new Error('Payment cancelled'));
        if (Date.now() - t0 >= ms) return resolve({ utr: `MOCK${intent.ref.replace(/\W/g, '').slice(-8).toUpperCase()}${String(Date.now()).slice(-4)}`, paidAt: Date.now() });
        setTimeout(tick, 150);
      };
      tick();
    });
  }
}

// ───────── AI cross-sell (deterministic stub until Phase 7 wires Claude)
export interface CrossSellSku { skuId: string; name: string; pricePaise: number; character?: string; departmentId?: string; subCategoryId?: string }
/** Suggests items that share a character with the cart but sit in a different department (affinity heuristic). */
export function crossSell(cartSkus: CrossSellSku[], catalogue: CrossSellSku[], limit = 3): CrossSellSku[] {
  if (!cartSkus.length) return [];
  const inCart = new Set(cartSkus.map((c) => c.skuId));
  const chars = new Set(cartSkus.map((c) => c.character).filter(Boolean));
  const depts = new Set(cartSkus.map((c) => c.departmentId));
  const score = (s: CrossSellSku) => (s.character && chars.has(s.character) ? 2 : 0) + (s.departmentId && !depts.has(s.departmentId) ? 1 : 0) + (s.pricePaise <= 49900 ? 0.5 : 0);
  return catalogue.filter((s) => !inCart.has(s.skuId)).map((s) => ({ s, sc: score(s) })).filter((x) => x.sc >= 2).sort((a, b) => b.sc - a.sc || a.s.pricePaise - b.s.pricePaise || a.s.skuId.localeCompare(b.s.skuId)).slice(0, limit).map((x) => x.s);
}
