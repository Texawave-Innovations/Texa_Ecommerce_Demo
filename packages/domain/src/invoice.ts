/** Sale invoice maths: GST on discounted inclusive prices, round-off, returns apportionment, double-entry journal. Pure. */
import type { PricedLine } from './promotions';

export interface InvoiceLine {
  lineId: string; skuId: string; name: string; hsn?: string; qty: number; gstRate: number;
  grossPaise: number; discountPaise: number; /** inclusive of GST */ netPaise: number;
  taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number;
}
export interface TaxSummaryRow { gstRate: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }
export interface InvoiceTotals {
  lines: InvoiceLine[]; taxSummary: TaxSummaryRow[];
  grossPaise: number; discountPaise: number; netPaise: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalTaxPaise: number;
  /** Round-off to whole rupees (can be negative). payable = net + roundOff. */
  roundOffPaise: number; payablePaise: number;
}

/** taxable = net ÷ (1 + rate); tax = net − taxable, split equally into CGST/SGST for intra-state supplies. */
export function buildInvoice(lines: PricedLine[], intraState: boolean): InvoiceTotals {
  const out: InvoiceLine[] = lines.map((l) => {
    const taxable = Math.round((l.netPaise * 100) / (100 + l.gstRate));
    const tax = l.netPaise - taxable;
    const cgst = intraState ? Math.floor(tax / 2) : 0;
    const sgst = intraState ? tax - cgst : 0;
    return { lineId: l.lineId, skuId: l.skuId, name: l.name, hsn: l.hsn, qty: l.qty, gstRate: l.gstRate, grossPaise: l.grossPaise, discountPaise: l.discountPaise, netPaise: l.netPaise, taxablePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: intraState ? 0 : tax };
  });
  const rows = new Map<number, TaxSummaryRow>();
  for (const l of out) {
    const r = rows.get(l.gstRate) ?? { gstRate: l.gstRate, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
    r.taxablePaise += l.taxablePaise; r.cgstPaise += l.cgstPaise; r.sgstPaise += l.sgstPaise; r.igstPaise += l.igstPaise; rows.set(l.gstRate, r);
  }
  const sum = (f: (l: InvoiceLine) => number) => out.reduce((a, l) => a + f(l), 0);
  const net = sum((l) => l.netPaise);
  const payable = Math.round(net / 100) * 100;
  return {
    lines: out, taxSummary: [...rows.values()].sort((a, b) => a.gstRate - b.gstRate),
    grossPaise: sum((l) => l.grossPaise), discountPaise: sum((l) => l.discountPaise), netPaise: net, taxablePaise: sum((l) => l.taxablePaise),
    cgstPaise: sum((l) => l.cgstPaise), sgstPaise: sum((l) => l.sgstPaise), igstPaise: sum((l) => l.igstPaise),
    totalTaxPaise: sum((l) => l.cgstPaise + l.sgstPaise + l.igstPaise), roundOffPaise: payable - net, payablePaise: payable,
  };
}

/** Refund for returning `qty` units of a line. The last units take the remainder so refunds always sum to the line net. */
export function refundForQty(o: { lineNetPaise: number; soldQty: number; returnedQty: number; refundedPaise: number; qty: number }): number {
  if (o.qty <= 0 || o.returnedQty + o.qty > o.soldQty) throw new Error('Return quantity exceeds quantity sold');
  if (o.returnedQty + o.qty === o.soldQty) return o.lineNetPaise - o.refundedPaise;
  return Math.round((o.lineNetPaise * o.qty) / o.soldQty);
}

// ───────────────────────────────────────────────────────────── journal
export interface JournalLine { ledgerId: string; drPaise: number; crPaise: number; narration?: string }
export const TENDER_LEDGER: Record<string, string> = { CASH: 'L-CASH', UPI: 'L-UPI-CLR', CARD: 'L-CARD-CLR', GC: 'L-GC-LIAB', CN: 'L-CN-LIAB', POINTS: 'L-LOY-LIAB', COD: 'L-COD-CLR', WEB: 'L-GW-CLR' };
export interface TenderLine { mode: string; amountPaise: number }

/**
 * Sale journal. Dr tenders (incl. gift-card/credit-note/loyalty liabilities) + round-off; Cr sales + output GST; Dr COGS / Cr inventory.
 * Always balances: tenders = payable = taxable + tax + roundOff.
 */
export function buildSaleJournal(inv: InvoiceTotals, tenders: TenderLine[], cogsPaise: number): JournalLine[] {
  const lines: JournalLine[] = [];
  const tendered = tenders.reduce((a, t) => a + t.amountPaise, 0);
  for (const t of tenders) if (t.amountPaise) lines.push({ ledgerId: TENDER_LEDGER[t.mode] ?? 'L-CASH', drPaise: t.amountPaise, crPaise: 0, narration: `${t.mode} tender` });
  const diff = inv.payablePaise - tendered;                    // change given back is netted off the cash tender by the caller; any remainder is a receivable gap
  if (diff !== 0) lines.push({ ledgerId: 'L-ROUNDOFF', drPaise: Math.max(0, diff), crPaise: Math.max(0, -diff), narration: 'Tender variance' });
  if (inv.roundOffPaise > 0) lines.push({ ledgerId: 'L-ROUNDOFF', drPaise: 0, crPaise: inv.roundOffPaise, narration: 'Round-off' });
  else if (inv.roundOffPaise < 0) lines.push({ ledgerId: 'L-ROUNDOFF', drPaise: -inv.roundOffPaise, crPaise: 0, narration: 'Round-off' });
  lines.push({ ledgerId: 'L-SALES', drPaise: 0, crPaise: inv.taxablePaise, narration: 'Retail sales (net of discount)' });
  if (inv.cgstPaise) lines.push({ ledgerId: 'L-CGST-OUT', drPaise: 0, crPaise: inv.cgstPaise });
  if (inv.sgstPaise) lines.push({ ledgerId: 'L-SGST-OUT', drPaise: 0, crPaise: inv.sgstPaise });
  if (inv.igstPaise) lines.push({ ledgerId: 'L-IGST-OUT', drPaise: 0, crPaise: inv.igstPaise });
  if (cogsPaise > 0) { lines.push({ ledgerId: 'L-COGS', drPaise: cogsPaise, crPaise: 0 }, { ledgerId: 'L-INV', drPaise: 0, crPaise: cogsPaise }); }
  return lines;
}
export const journalBalanced = (j: JournalLine[]) => j.reduce((a, l) => a + l.drPaise, 0) === j.reduce((a, l) => a + l.crPaise, 0);

/** Reverses a sale journal (void / full return): swaps Dr/Cr and books sales to the sales-returns ledger. */
export function reverseJournal(j: JournalLine[]): JournalLine[] {
  return j.map((l) => ({ ledgerId: l.ledgerId === 'L-SALES' ? 'L-SALES-RET' : l.ledgerId, drPaise: l.crPaise, crPaise: l.drPaise, narration: `Reversal${l.narration ? ` — ${l.narration}` : ''}` }));
}
