/**
 * One Firestore trigger per source collection that posts the GL journal for it. Idempotent: every handler first checks
 * whether a journal already exists for the document (refType+refId) and skips if so — safe to re-run, safe for a backfill.
 * Sales and returns already post their journal inline inside the same transaction as the business write (pos/sale.ts,
 * pos/returns.ts) — their triggers are a defensive backstop that normally finds the journal already there and no-ops.
 */
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { buildJournal, buildTallyEnvelope, buildTallyVoucher, PAYMENT_MODE_LEDGER, TALLY_VOUCHER_FOR_EVENT } from '@texafashions/domain';
import { WAREHOUSE_ID } from '@texafashions/types';
import { FieldValue, REGION, col } from '../admin';
import { ymd } from '../engine';

type Doc = Record<string, any>;

async function alreadyPosted(refType: string, refId: string): Promise<boolean> {
  const s = await col('journals').where('refType', '==', refType).where('refId', '==', refId).limit(1).get();
  return !s.empty;
}

async function writeJournal(event: string, refType: string, refId: string, storeId: string, lines: ReturnType<typeof buildJournal>, extra: Doc = {}) {
  await col('journals').add({ event, refType, refId, storeId, day: ymd(), lines, balanced: true, at: FieldValue.serverTimestamp(), ...extra });
}

/** Enqueues a Tally-sync item for every posted journal: renders the voucher XML immediately (ledger names resolved once
 * from the chart of accounts), so `apps/tally-agent` only has to POST a ready-made envelope and record the outcome. */
export const enqueueTallySync = onDocumentCreated({ document: 'orgs/{orgId}/journals/{id}', region: REGION }, async (event) => {
  const j = event.data?.data() as Doc | undefined; if (!j) return;
  const ledgersSnap = await col('ledgers').get();
  const ledgerNames = Object.fromEntries(ledgersSnap.docs.map((d) => [d.id, (d.get('tallyName') as string | undefined) ?? d.id]));
  const voucherType = TALLY_VOUCHER_FOR_EVENT[j.event] ?? 'Journal';
  const voucher = buildTallyVoucher({ voucherType, date: j.day, voucherNumber: j.refId ?? event.params.id, narration: `${j.event} — ${j.refType} ${j.refId}`, lines: j.lines, ledgerNames });
  const xml = buildTallyEnvelope('Texa Fashions', [voucher]);
  await col('tallyQueue').add({ status: 'queued', voucherType, storeId: j.storeId, day: j.day, refType: j.refType, refId: j.refId, journalId: event.params.id, xml, attempts: 0, lastError: null, createdAt: FieldValue.serverTimestamp() });
});

export async function postSaleJournalNow(saleId: string) {
  if (await alreadyPosted('sale', saleId)) return { skipped: true };
  console.warn(`sale ${saleId} has no journal yet — completeSaleCore should have posted one inline`);
  return { skipped: true };
}
export async function postReturnJournalNow(returnId: string) {
  if (await alreadyPosted('return', returnId)) return { skipped: true };
  console.warn(`return ${returnId} has no journal yet — processReturn/voidSale should have posted one inline`);
  return { skipped: true };
}

/** GRN: Dr inventory / Cr GR/IR clearing, at the PO cost of the good units received. */
export async function postGrnJournalNow(grnId: string) {
  if (await alreadyPosted('grn', grnId)) return { skipped: true };
  const g = (await col('grns').doc(grnId).get()).data() as Doc | undefined;
  if (!g) return { skipped: true };
  const valuePaise = (g.lines as Doc[]).reduce((a, l) => a + l.goodQty * l.unitCostPaise, 0);
  if (valuePaise <= 0) return { skipped: true };
  const lines = buildJournal({ kind: 'grn', input: { valuePaise } });
  await writeJournal('grn', 'grn', grnId, g.locationId, lines, { poId: g.poId });
  return { posted: true, valuePaise };
}

/** Purchase invoice matched into AP: clears GR/IR, books input GST, raises the creditor. Fires once the invoice has an AP bill (status matched/overridden). */
export async function postPurchaseInvoiceJournalNow(invoiceId: string) {
  if (await alreadyPosted('purchaseInvoice', invoiceId)) return { skipped: true };
  const inv = (await col('purchaseInvoices').doc(invoiceId).get()).data() as Doc | undefined;
  if (!inv || !['matched', 'overridden'].includes(inv.status)) return { skipped: true };
  const po = (await col('purchaseOrders').doc(inv.poId).get()).data() as Doc | undefined;
  const lines = buildJournal({ kind: 'purchaseInvoice', input: { taxablePaise: inv.taxablePaise, taxPaise: inv.taxPaise, totalPaise: inv.totalPaise, intraState: !!po?.intraState } });
  await writeJournal('purchase_invoice', 'purchaseInvoice', invoiceId, WAREHOUSE_ID, lines, { vendorId: inv.vendorId, poId: inv.poId });
  return { posted: true };
}

/** Vendor payment posted: Dr AP / Cr bank + Cr TDS payable. Fires once the voucher is `posted` (auto-approved or maker-checker approved). */
export async function postPaymentVoucherJournalNow(paymentId: string) {
  if (await alreadyPosted('paymentVoucher', paymentId)) return { skipped: true };
  const v = (await col('paymentVouchers').doc(paymentId).get()).data() as Doc | undefined;
  if (!v || v.status !== 'posted') return { skipped: true };
  const bankLedgerId = PAYMENT_MODE_LEDGER[v.mode] ?? 'L-BANK-HDFC';
  const tdsPaise = v.tdsPaise ?? 0; const netPaise = v.netPaise ?? v.amountPaise - tdsPaise;
  const lines = buildJournal({ kind: 'vendorPayment', input: { amountPaise: v.amountPaise, tdsPaise, netPaise, bankLedgerId } });
  await writeJournal('vendor_payment', 'paymentVoucher', paymentId, WAREHOUSE_ID, lines, { vendorId: v.vendorId });
  return { posted: true };
}

/** Stock transfer dispatched: Dr goods-in-transit / Cr inventory, plus a self-invoice IGST wash for inter-state transfers. */
export async function postStockTransferJournalNow(transferId: string) {
  if (await alreadyPosted('stockTransfer', transferId)) return { skipped: true };
  const t = (await col('stockTransfers').doc(transferId).get()).data() as Doc | undefined;
  if (!t || t.status !== 'in_transit') return { skipped: true };
  const lines = buildJournal({ kind: 'stockTransfer', input: { valuePaise: t.valuePaise, interState: !!t.interState, igstPaise: t.taxInvoice?.igstPaise ?? 0 } });
  await writeJournal('stock_transfer', 'stockTransfer', transferId, t.fromLocationId, lines, { toLocationId: t.toLocationId });
  return { posted: true };
}

export const postSaleJournal = onDocumentCreated({ document: 'orgs/{orgId}/sales/{id}', region: REGION }, async (event) => { await postSaleJournalNow(event.params.id); });
export const postReturnJournal = onDocumentCreated({ document: 'orgs/{orgId}/returns/{id}', region: REGION }, async (event) => { await postReturnJournalNow(event.params.id); });
export const postGrnJournal = onDocumentCreated({ document: 'orgs/{orgId}/grns/{id}', region: REGION }, async (event) => { await postGrnJournalNow(event.params.id); });
export const postPurchaseInvoiceJournal = onDocumentWritten({ document: 'orgs/{orgId}/purchaseInvoices/{id}', region: REGION }, async (event) => { await postPurchaseInvoiceJournalNow(event.params.id); });
export const postPaymentVoucherJournal = onDocumentWritten({ document: 'orgs/{orgId}/paymentVouchers/{id}', region: REGION }, async (event) => { await postPaymentVoucherJournalNow(event.params.id); });
export const postStockTransferJournal = onDocumentWritten({ document: 'orgs/{orgId}/stockTransfers/{id}', region: REGION }, async (event) => { await postStockTransferJournalNow(event.params.id); });
