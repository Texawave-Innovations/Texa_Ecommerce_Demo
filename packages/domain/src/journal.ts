/** General-ledger journal builders for every posting event. Pure, no Firestore. Every builder rejects an unbalanced result. */
import { buildSaleJournal, journalBalanced, reverseJournal, TENDER_LEDGER, type InvoiceTotals, type JournalLine, type TenderLine } from './invoice';
import { buildReturnJournal, type RefundPart, type ReturnJournalLine } from './returnJournal';

export { journalBalanced, type JournalLine } from './invoice';

function sum(lines: JournalLine[], f: (l: JournalLine) => number) { return lines.reduce((a, l) => a + f(l), 0); }

/** Throws if debits ≠ credits. Every builder below runs its result through this before returning. */
export function assertBalanced(lines: JournalLine[], context = 'journal'): JournalLine[] {
  if (!journalBalanced(lines)) {
    throw new Error(`Unbalanced ${context}: Dr ₹${(sum(lines, (l) => l.drPaise) / 100).toFixed(2)} ≠ Cr ₹${(sum(lines, (l) => l.crPaise) / 100).toFixed(2)}`);
  }
  return lines;
}

// ───────────────────────────────────────────────────────────── GRN (goods received, pending invoice)
export interface GrnJournalInput { valuePaise: number }
/** Dr inventory / Cr GR/IR clearing, at the PO cost of goods accepted into QC. */
export function buildGrnJournal(i: GrnJournalInput): JournalLine[] {
  return assertBalanced([
    { ledgerId: 'L-INV', drPaise: i.valuePaise, crPaise: 0, narration: 'Goods received' },
    { ledgerId: 'L-GRIR-CLR', drPaise: 0, crPaise: i.valuePaise, narration: 'GR/IR clearing' },
  ], 'GRN journal');
}

// ───────────────────────────────────────────────────────────── Purchase invoice (AP bill created)
export interface PurchaseInvoiceJournalInput { taxablePaise: number; taxPaise: number; totalPaise: number; intraState: boolean }
/** Clears the GR/IR liability at invoice taxable value, books input GST, raises the sundry-creditor (AP) balance. */
export function buildPurchaseInvoiceJournal(i: PurchaseInvoiceJournalInput): JournalLine[] {
  const cgst = i.intraState ? Math.floor(i.taxPaise / 2) : 0;
  const sgst = i.intraState ? i.taxPaise - cgst : 0;
  const igst = i.intraState ? 0 : i.taxPaise;
  const lines: JournalLine[] = [{ ledgerId: 'L-GRIR-CLR', drPaise: i.taxablePaise, crPaise: 0, narration: 'Clear GR/IR on invoice' }];
  if (cgst) lines.push({ ledgerId: 'L-CGST-IN', drPaise: cgst, crPaise: 0, narration: 'Input CGST' });
  if (sgst) lines.push({ ledgerId: 'L-SGST-IN', drPaise: sgst, crPaise: 0, narration: 'Input SGST' });
  if (igst) lines.push({ ledgerId: 'L-IGST-IN', drPaise: igst, crPaise: 0, narration: 'Input IGST' });
  lines.push({ ledgerId: 'L-AP', drPaise: 0, crPaise: i.totalPaise, narration: 'Sundry creditor' });
  return assertBalanced(lines, 'purchase invoice journal');
}

// ───────────────────────────────────────────────────────────── Vendor payment
export interface VendorPaymentJournalInput { amountPaise: number; tdsPaise: number; netPaise: number; bankLedgerId: string }
/** Dr AP (clears the creditor) / Cr bank (cash out) + Cr TDS payable. Covers advances too (amountPaise = i.netPaise + i.tdsPaise). */
export function buildVendorPaymentJournal(i: VendorPaymentJournalInput): JournalLine[] {
  const lines: JournalLine[] = [
    { ledgerId: 'L-AP', drPaise: i.amountPaise, crPaise: 0, narration: 'Vendor payment' },
    { ledgerId: i.bankLedgerId, drPaise: 0, crPaise: i.netPaise, narration: 'Paid' },
  ];
  if (i.tdsPaise) lines.push({ ledgerId: 'L-TDS', drPaise: 0, crPaise: i.tdsPaise, narration: 'TDS withheld' });
  return assertBalanced(lines, 'vendor payment journal');
}
export const PAYMENT_MODE_LEDGER: Record<string, string> = { cash: 'L-CASH', upi: 'L-UPI-CLR', bank_transfer: 'L-BANK-HDFC', cheque: 'L-BANK-HDFC' };

// ───────────────────────────────────────────────────────────── Stock transfer (dispatch)
export interface StockTransferJournalInput { valuePaise: number; interState: boolean; igstPaise?: number }
/** Dr goods-in-transit / Cr inventory at the source location's cost. Inter-state (distinct GSTIN) transfers self-invoice IGST, which nets to zero across the two entries. */
export function buildStockTransferJournal(i: StockTransferJournalInput): JournalLine[] {
  const lines: JournalLine[] = [
    { ledgerId: 'L-GIT', drPaise: i.valuePaise, crPaise: 0, narration: 'Stock transfer — in transit' },
    { ledgerId: 'L-INV', drPaise: 0, crPaise: i.valuePaise, narration: 'Dispatched' },
  ];
  if (i.interState && i.igstPaise) lines.push(
    { ledgerId: 'L-IGST-IN', drPaise: i.igstPaise, crPaise: 0, narration: 'Self-invoice IGST (input)' },
    { ledgerId: 'L-IGST-OUT', drPaise: 0, crPaise: i.igstPaise, narration: 'Self-invoice IGST (output)' },
  );
  return assertBalanced(lines, 'stock transfer journal');
}

// ───────────────────────────────────────────────────────────── Gift cards
/** Selling (or topping up) a gift card: Dr the tender, Cr the liability — no revenue is recognised until redeemed. */
export function buildGiftCardSaleJournal(amountPaise: number, tenderMode: string, cardId: string): JournalLine[] {
  return assertBalanced([
    { ledgerId: TENDER_LEDGER[tenderMode] ?? 'L-CASH', drPaise: amountPaise, crPaise: 0, narration: 'Gift card sale' },
    { ledgerId: 'L-GC-LIAB', drPaise: 0, crPaise: amountPaise, narration: `Gift card ${cardId}` },
  ], 'gift card sale journal');
}
/** Redeeming a gift card balance for cash (outside a merchandise sale, e.g. a goodwill payout). Redemption as sale *tender* is already booked by `buildSaleJournal` via `TENDER_LEDGER.GC`. */
export function buildGiftCardRedeemJournal(amountPaise: number, cardId: string): JournalLine[] {
  return assertBalanced([
    { ledgerId: 'L-GC-LIAB', drPaise: amountPaise, crPaise: 0, narration: `Gift card ${cardId} redeemed for cash` },
    { ledgerId: 'L-CASH', drPaise: 0, crPaise: amountPaise, narration: 'Cash paid out' },
  ], 'gift card redeem journal');
}

// ───────────────────────────────────────────────────────────── Payroll
export interface PayrollJournalInput { grossPaise: number; pfEmployeePaise: number; esiEmployeePaise: number; ptPaise: number; tdsPaise: number; netPaise: number }
/** Dr salaries & wages (gross) / Cr PF, ESI, PT and TDS payable at the employee's withheld amounts, and Cr net salary payable (to be paid out via the bank-transfer file). */
export function buildPayrollJournal(i: PayrollJournalInput): JournalLine[] {
  const lines: JournalLine[] = [{ ledgerId: 'L-SAL', drPaise: i.grossPaise, crPaise: 0, narration: 'Salaries & wages' }];
  if (i.pfEmployeePaise) lines.push({ ledgerId: 'L-PF-PAY', drPaise: 0, crPaise: i.pfEmployeePaise, narration: 'PF payable' });
  if (i.esiEmployeePaise) lines.push({ ledgerId: 'L-ESI-PAY', drPaise: 0, crPaise: i.esiEmployeePaise, narration: 'ESI payable' });
  if (i.ptPaise) lines.push({ ledgerId: 'L-PT-PAY', drPaise: 0, crPaise: i.ptPaise, narration: 'Professional tax payable' });
  if (i.tdsPaise) lines.push({ ledgerId: 'L-TDS', drPaise: 0, crPaise: i.tdsPaise, narration: 'TDS payable' });
  lines.push({ ledgerId: 'L-SAL-PAY', drPaise: 0, crPaise: i.netPaise, narration: 'Net salary payable' });
  return assertBalanced(lines, 'payroll journal');
}

// ───────────────────────────────────────────────────────────── Unified dispatcher
export type JournalEvent =
  | { kind: 'sale'; invoice: InvoiceTotals; tenders: TenderLine[]; cogsPaise: number }
  | { kind: 'return'; lines: ReturnJournalLine[]; parts: RefundPart[] }
  | { kind: 'voidSale'; saleJournal: JournalLine[] }
  | { kind: 'grn'; input: GrnJournalInput }
  | { kind: 'purchaseInvoice'; input: PurchaseInvoiceJournalInput }
  | { kind: 'vendorPayment'; input: VendorPaymentJournalInput }
  | { kind: 'stockTransfer'; input: StockTransferJournalInput }
  | { kind: 'giftCardSale'; amountPaise: number; tenderMode: string; cardId: string }
  | { kind: 'giftCardRedeem'; amountPaise: number; cardId: string }
  | { kind: 'payroll'; input: PayrollJournalInput };

/** One entry point for every posting event. Always returns a balanced journal or throws. */
export function buildJournal(event: JournalEvent): JournalLine[] {
  switch (event.kind) {
    case 'sale': return assertBalanced(buildSaleJournal(event.invoice, event.tenders, event.cogsPaise), 'sale journal');
    case 'return': return assertBalanced(buildReturnJournal(event.lines, event.parts), 'return journal');
    case 'voidSale': return assertBalanced(reverseJournal(event.saleJournal), 'void journal');
    case 'grn': return buildGrnJournal(event.input);
    case 'purchaseInvoice': return buildPurchaseInvoiceJournal(event.input);
    case 'vendorPayment': return buildVendorPaymentJournal(event.input);
    case 'stockTransfer': return buildStockTransferJournal(event.input);
    case 'giftCardSale': return buildGiftCardSaleJournal(event.amountPaise, event.tenderMode, event.cardId);
    case 'giftCardRedeem': return buildGiftCardRedeemJournal(event.amountPaise, event.cardId);
    case 'payroll': return buildPayrollJournal(event.input);
  }
}
