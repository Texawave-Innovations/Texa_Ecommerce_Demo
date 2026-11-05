/** Phase 5 GST return summaries. Pure aggregation over rows the caller (a Cloud Function) reads from Firestore —
 * this module never touches Firestore so it can be unit-tested and reused unchanged by the NestJS backend. */

export interface GstSaleRow {
  invoiceNo: string; invoiceDate: string; channel: 'store' | 'web';
  placeOfSupplyState: string; customerGstin?: string | null;
  hsn: string; gstRate: number; qty: number;
  taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number;
}

// ───────────────────────── GSTR-1
export interface Gstr1B2cRow { placeOfSupplyState: string; gstRate: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; invoiceCount: number }
/** B2C (Others) table: no customer GSTIN — grouped by place of supply + rate, per GSTR-1 table 7. */
export function gstr1B2cSummary(rows: GstSaleRow[]): Gstr1B2cRow[] {
  const byKey = new Map<string, Gstr1B2cRow>();
  for (const r of rows.filter((r) => !r.customerGstin)) {
    const key = `${r.placeOfSupplyState}|${r.gstRate}`;
    const row = byKey.get(key) ?? { placeOfSupplyState: r.placeOfSupplyState, gstRate: r.gstRate, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, invoiceCount: 0 };
    row.taxablePaise += r.taxablePaise; row.cgstPaise += r.cgstPaise; row.sgstPaise += r.sgstPaise; row.igstPaise += r.igstPaise; row.invoiceCount++;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => a.placeOfSupplyState.localeCompare(b.placeOfSupplyState) || a.gstRate - b.gstRate);
}

export interface Gstr1B2bRow { customerGstin: string; invoiceNo: string; invoiceDate: string; placeOfSupplyState: string; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }
/** B2B invoice-wise table (GSTR-1 table 4) — only rows carrying a customer GSTIN. */
export function gstr1B2bSummary(rows: GstSaleRow[]): Gstr1B2bRow[] {
  const byInvoice = new Map<string, Gstr1B2bRow>();
  for (const r of rows.filter((r) => r.customerGstin)) {
    const key = `${r.customerGstin}|${r.invoiceNo}`;
    const row = byInvoice.get(key) ?? { customerGstin: r.customerGstin!, invoiceNo: r.invoiceNo, invoiceDate: r.invoiceDate, placeOfSupplyState: r.placeOfSupplyState, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
    row.taxablePaise += r.taxablePaise; row.cgstPaise += r.cgstPaise; row.sgstPaise += r.sgstPaise; row.igstPaise += r.igstPaise;
    byInvoice.set(key, row);
  }
  return [...byInvoice.values()].sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
}

export interface Gstr1HsnRow { hsn: string; gstRate: number; totalQty: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalTaxPaise: number }
/** HSN-wise summary (GSTR-1 table 12) — every outward supply, B2B and B2C together, grouped by HSN + rate. */
export function gstr1HsnSummary(rows: GstSaleRow[]): Gstr1HsnRow[] {
  const byKey = new Map<string, Gstr1HsnRow>();
  for (const r of rows) {
    const key = `${r.hsn}|${r.gstRate}`;
    const row = byKey.get(key) ?? { hsn: r.hsn, gstRate: r.gstRate, totalQty: 0, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalTaxPaise: 0 };
    row.totalQty += r.qty; row.taxablePaise += r.taxablePaise; row.cgstPaise += r.cgstPaise; row.sgstPaise += r.sgstPaise; row.igstPaise += r.igstPaise;
    row.totalTaxPaise = row.cgstPaise + row.sgstPaise + row.igstPaise;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.gstRate - b.gstRate);
}

// ───────────────────────── GSTR-3B
export interface GstPurchaseRow { vendorGstin?: string | null; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }
export interface Gstr3bTable {
  outwardTaxableSupplies: { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number };
  eligibleItc: { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number };
  netTaxPayable: { cgstPaise: number; sgstPaise: number; igstPaise: number };
}
/** Table 3.1 (outward supplies) and table 4 (ITC) of GSTR-3B — ITC is assumed fully eligible (demo scope, no blocked-credit rules). */
export function gstr3bTable(sales: GstSaleRow[], purchases: GstPurchaseRow[]): Gstr3bTable {
  const outwardTaxableSupplies = sales.reduce((a, r) => ({ taxablePaise: a.taxablePaise + r.taxablePaise, cgstPaise: a.cgstPaise + r.cgstPaise, sgstPaise: a.sgstPaise + r.sgstPaise, igstPaise: a.igstPaise + r.igstPaise }), { taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 });
  const eligibleItc = purchases.reduce((a, r) => ({ taxablePaise: a.taxablePaise + r.taxablePaise, cgstPaise: a.cgstPaise + r.cgstPaise, sgstPaise: a.sgstPaise + r.sgstPaise, igstPaise: a.igstPaise + r.igstPaise }), { taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 });
  const netTaxPayable = {
    cgstPaise: Math.max(0, outwardTaxableSupplies.cgstPaise - eligibleItc.cgstPaise),
    sgstPaise: Math.max(0, outwardTaxableSupplies.sgstPaise - eligibleItc.sgstPaise),
    igstPaise: Math.max(0, outwardTaxableSupplies.igstPaise - eligibleItc.igstPaise),
  };
  return { outwardTaxableSupplies, eligibleItc, netTaxPayable };
}

// ───────────────────────── GSTR-2B reconciliation
export interface BookPurchaseRow { vendorGstin: string; invoiceNo: string; invoiceDate: string; taxablePaise: number; taxPaise: number }
export interface Gstr2bRow { vendorGstin: string; invoiceNo: string; invoiceDate: string; taxablePaise: number; taxPaise: number }
export interface Gstr2bMismatchRow { vendorGstin: string; invoiceNo: string; status: 'matched' | 'value_mismatch' | 'missing_in_books' | 'missing_in_2b'; bookTaxablePaise?: number; gstr2bTaxablePaise?: number; bookTaxPaise?: number; gstr2bTaxPaise?: number; deltaPaise: number }

const TOLERANCE_PAISE = 100; // ₹1 rounding tolerance, per GSTN matching convention
/** Matches books (purchase invoices) against the vendor-filed GSTR-2B feed, by vendor GSTIN + invoice number. */
export function gstr2bMismatch(books: BookPurchaseRow[], gstr2b: Gstr2bRow[]): Gstr2bMismatchRow[] {
  const key = (vendorGstin: string, invoiceNo: string) => `${vendorGstin}|${invoiceNo.trim().toUpperCase()}`;
  const bookMap = new Map(books.map((b) => [key(b.vendorGstin, b.invoiceNo), b]));
  const bMap = new Map(gstr2b.map((b) => [key(b.vendorGstin, b.invoiceNo), b]));
  const rows: Gstr2bMismatchRow[] = [];
  for (const [k, book] of bookMap) {
    const two = bMap.get(k);
    if (!two) { rows.push({ vendorGstin: book.vendorGstin, invoiceNo: book.invoiceNo, status: 'missing_in_2b', bookTaxablePaise: book.taxablePaise, bookTaxPaise: book.taxPaise, deltaPaise: book.taxPaise }); continue; }
    const deltaPaise = book.taxPaise - two.taxPaise;
    rows.push({
      vendorGstin: book.vendorGstin, invoiceNo: book.invoiceNo, status: Math.abs(deltaPaise) <= TOLERANCE_PAISE ? 'matched' : 'value_mismatch',
      bookTaxablePaise: book.taxablePaise, gstr2bTaxablePaise: two.taxablePaise, bookTaxPaise: book.taxPaise, gstr2bTaxPaise: two.taxPaise, deltaPaise,
    });
  }
  for (const [k, two] of bMap) if (!bookMap.has(k)) rows.push({ vendorGstin: two.vendorGstin, invoiceNo: two.invoiceNo, status: 'missing_in_books', gstr2bTaxablePaise: two.taxablePaise, gstr2bTaxPaise: two.taxPaise, deltaPaise: -two.taxPaise });
  return rows.sort((a, b) => a.vendorGstin.localeCompare(b.vendorGstin) || a.invoiceNo.localeCompare(b.invoiceNo));
}
