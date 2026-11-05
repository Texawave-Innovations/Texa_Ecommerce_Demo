import type { JournalLine } from './invoice';
import { TENDER_LEDGER } from './invoice';

export interface ReturnJournalLine { refundPaise: number; gstRate: number; intraState: boolean; /** cost of units put back (0 for services) */ restockCostPaise: number; damaged?: boolean }
export interface RefundPart { mode: string; amountPaise: number }

/**
 * Journal for a (partial) POS return: Dr sales-returns (taxable part) + output GST; Cr refund tenders / credit-note liability;
 * Dr inventory (or shrinkage when damaged) / Cr COGS for the restocked units. Always balances when parts sum to the refunds.
 */
export function buildReturnJournal(lines: ReturnJournalLine[], parts: RefundPart[]): JournalLine[] {
  let taxable = 0, cgst = 0, sgst = 0, igst = 0, inv = 0, shrink = 0;
  for (const l of lines) {
    const t = Math.round((l.refundPaise * 100) / (100 + l.gstRate)); const tax = l.refundPaise - t;
    taxable += t;
    if (l.intraState) { const c = Math.floor(tax / 2); cgst += c; sgst += tax - c; } else igst += tax;
    if (l.damaged) shrink += l.restockCostPaise; else inv += l.restockCostPaise;
  }
  const out: JournalLine[] = [{ ledgerId: 'L-SALES-RET', drPaise: taxable, crPaise: 0, narration: 'Sales return' }];
  if (cgst) out.push({ ledgerId: 'L-CGST-OUT', drPaise: cgst, crPaise: 0 });
  if (sgst) out.push({ ledgerId: 'L-SGST-OUT', drPaise: sgst, crPaise: 0 });
  if (igst) out.push({ ledgerId: 'L-IGST-OUT', drPaise: igst, crPaise: 0 });
  for (const p of parts) if (p.amountPaise) out.push({ ledgerId: TENDER_LEDGER[p.mode] ?? 'L-CASH', drPaise: 0, crPaise: p.amountPaise, narration: `${p.mode} refund` });
  const total = lines.reduce((a, l) => a + l.refundPaise, 0); const paid = parts.reduce((a, p) => a + p.amountPaise, 0);
  if (total !== paid) out.push({ ledgerId: 'L-ROUNDOFF', drPaise: Math.max(0, paid - total), crPaise: Math.max(0, total - paid), narration: 'Refund variance' });
  if (inv) out.push({ ledgerId: 'L-INV', drPaise: inv, crPaise: 0 });
  if (shrink) out.push({ ledgerId: 'L-SHRINK', drPaise: shrink, crPaise: 0 });
  if (inv + shrink) out.push({ ledgerId: 'L-COGS', drPaise: 0, crPaise: inv + shrink });
  return out;
}
