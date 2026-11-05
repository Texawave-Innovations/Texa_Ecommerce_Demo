/** Phase 5 — TallyPrime XML (HTTP import) envelopes. Pure string building: no Firestore, no HTTP.
 * `apps/tally-agent` POSTs the resulting envelope to TallyPrime's XML server (localhost:9000). */
import type { JournalLine } from './journal';

export type TallyVoucherType = 'Sales' | 'Purchase' | 'Payment' | 'Receipt' | 'Credit Note' | 'Debit Note' | 'Journal';

export interface TallyVoucherInput {
  voucherType: TallyVoucherType; date: string /* YYYY-MM-DD */; narration: string; voucherNumber: string;
  lines: JournalLine[]; ledgerNames?: Record<string, string> /* ledgerId → exact Tally ledger name, defaults to ledgerId */;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tallyDate = (d: string) => d.replace(/-/g, '');
/** Tally convention: debit entries are positive with ISDEEMEDPOSITIVE Yes, credit entries negative with No. */
const ledgerEntry = (ledgerName: string, drPaise: number, crPaise: number) => {
  const positive = drPaise > 0; const amountPaise = positive ? drPaise : crPaise;
  return `      <ALLLEDGERENTRIES.LIST>\n        <LEDGERNAME>${esc(ledgerName)}</LEDGERNAME>\n        <ISDEEMEDPOSITIVE>${positive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>\n        <AMOUNT>${positive ? '' : '-'}${(amountPaise / 100).toFixed(2)}</AMOUNT>\n      </ALLLEDGERENTRIES.LIST>`;
};

/** One `<VOUCHER>` built from a balanced journal — the shared body for every voucher type below. */
export function buildTallyVoucher(v: TallyVoucherInput): string {
  const names = v.ledgerNames ?? {};
  const entries = v.lines.map((l) => ledgerEntry(names[l.ledgerId] ?? l.ledgerId, l.drPaise, l.crPaise)).join('\n');
  return [
    `    <VOUCHER VCHTYPE="${esc(v.voucherType)}" ACTION="Create">`,
    `      <DATE>${tallyDate(v.date)}</DATE>`,
    `      <VOUCHERTYPENAME>${esc(v.voucherType)}</VOUCHERTYPENAME>`,
    `      <VOUCHERNUMBER>${esc(v.voucherNumber)}</VOUCHERNUMBER>`,
    `      <NARRATION>${esc(v.narration)}</NARRATION>`,
    entries,
    `    </VOUCHER>`,
  ].join('\n');
}

/** Wraps one or more vouchers in the full `Import Data` envelope TallyPrime's XML server (`:9000`) accepts. */
export function buildTallyEnvelope(companyName: string, vouchers: string[]): string {
  return [
    `<ENVELOPE>`,
    `  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>`,
    `  <BODY>`,
    `    <IMPORTDATA>`,
    `      <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>`,
    `      <REQUESTDATA>`,
    `        <TALLYMESSAGE xmlns:UDF="TallyUDF">`,
    vouchers.join('\n'),
    `        </TALLYMESSAGE>`,
    `      </REQUESTDATA>`,
    `    </IMPORTDATA>`,
    `  </BODY>`,
    `</ENVELOPE>`,
  ].join('\n');
}

const envelopeFor = (type: TallyVoucherType) => (companyName: string, date: string, voucherNumber: string, narration: string, lines: JournalLine[], ledgerNames?: Record<string, string>) =>
  buildTallyEnvelope(companyName, [buildTallyVoucher({ voucherType: type, date, voucherNumber, narration, lines, ledgerNames })]);

/** Sales voucher — one per store per day, aggregating every sale journal for that store+day into a single voucher. */
export const buildSalesVoucherXml = envelopeFor('Sales');
export const buildPurchaseVoucherXml = envelopeFor('Purchase');
export const buildPaymentVoucherXml = envelopeFor('Payment');
export const buildReceiptVoucherXml = envelopeFor('Receipt');
export const buildCreditNoteXml = envelopeFor('Credit Note');
export const buildDebitNoteXml = envelopeFor('Debit Note');
export const buildJournalVoucherXml = envelopeFor('Journal');

/** Maps a posted GL journal's `event` kind to the TallyPrime voucher type it should sync as. */
export const TALLY_VOUCHER_FOR_EVENT: Record<string, TallyVoucherType> = {
  sale: 'Sales', return: 'Credit Note', voidSale: 'Credit Note', grn: 'Journal', purchase_invoice: 'Purchase',
  vendor_payment: 'Payment', stock_transfer: 'Journal', giftCardSale: 'Receipt', giftCardRedeem: 'Journal',
};
