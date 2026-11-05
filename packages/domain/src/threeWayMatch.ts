export interface Tolerance { priceBps: number; qtyUnits: number; totalBps: number }
export const DEFAULT_TOLERANCE: Tolerance = { priceBps: 200, qtyUnits: 0, totalBps: 100 };

export interface MatchPoLine { skuId: string; orderedQty: number; unitPriceMinor: number }
export interface MatchGrnLine { skuId: string; acceptedQty: number }
export interface MatchInvLine { skuId: string; qty: number; unitPriceMinor: number }
export type MatchIssue = 'not_on_po' | 'no_grn' | 'over_billed_qty' | 'price_variance' | 'over_ordered';
export interface MatchLineResult { skuId: string; poQty: number; grnQty: number; billedBefore: number; invQty: number; poPrice: number; invPrice: number; issues: MatchIssue[] }
export interface MatchResult { status: 'matched' | 'hold'; lines: MatchLineResult[]; reasons: string[]; invoiceTotalMinor: number; allowedTotalMinor: number; totalVarianceMinor: number }

const ISSUE_TEXT: Record<MatchIssue, string> = {
  not_on_po: 'SKU is not on the PO', no_grn: 'Nothing accepted on GRN yet', over_billed_qty: 'Invoice quantity exceeds accepted GRN quantity',
  price_variance: 'Unit price above PO price beyond tolerance', over_ordered: 'Invoice quantity exceeds PO quantity',
};

/**
 * 3-way match PO ↔ GRN ↔ Invoice. Quantity billable = accepted GRN qty − qty already billed on earlier invoices.
 * Price may exceed the PO price by `priceBps` basis points. Anything outside tolerance puts the invoice on HOLD.
 */
export function threeWayMatch(po: MatchPoLine[], grn: MatchGrnLine[], inv: MatchInvLine[], billedBefore: Record<string, number> = {}, tol: Tolerance = DEFAULT_TOLERANCE): MatchResult {
  const poBy = new Map(po.map((l) => [l.skuId, l]));
  const grnQty = new Map<string, number>();
  for (const g of grn) grnQty.set(g.skuId, (grnQty.get(g.skuId) ?? 0) + g.acceptedQty);
  const lines: MatchLineResult[] = [];
  let invTotal = 0, allowedTotal = 0;
  for (const l of inv) {
    const p = poBy.get(l.skuId);
    const received = grnQty.get(l.skuId) ?? 0;
    const before = billedBefore[l.skuId] ?? 0;
    const issues: MatchIssue[] = [];
    if (!p) issues.push('not_on_po');
    else {
      if (received === 0) issues.push('no_grn');
      else if (l.qty > received - before + tol.qtyUnits) issues.push('over_billed_qty');
      if (l.qty + before > p.orderedQty + tol.qtyUnits) issues.push('over_ordered');
      if (l.unitPriceMinor > Math.floor((p.unitPriceMinor * (10000 + tol.priceBps)) / 10000)) issues.push('price_variance');
    }
    invTotal += l.qty * l.unitPriceMinor;
    allowedTotal += l.qty * (p?.unitPriceMinor ?? 0);
    lines.push({ skuId: l.skuId, poQty: p?.orderedQty ?? 0, grnQty: received, billedBefore: before, invQty: l.qty, poPrice: p?.unitPriceMinor ?? 0, invPrice: l.unitPriceMinor, issues });
  }
  const variance = invTotal - allowedTotal;
  const reasons = lines.flatMap((l) => l.issues.map((i) => `${l.skuId}: ${ISSUE_TEXT[i]}`));
  if (allowedTotal > 0 && variance * 10000 > allowedTotal * tol.totalBps && !reasons.length) reasons.push('Invoice total exceeds PO value beyond tolerance');
  return { status: reasons.length ? 'hold' : 'matched', lines, reasons, invoiceTotalMinor: invTotal, allowedTotalMinor: allowedTotal, totalVarianceMinor: variance };
}
