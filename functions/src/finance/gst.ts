/** GST return callables. Reads sales (store) + webOrders (ecommerce) for outward supplies, purchaseInvoices for ITC,
 * and the seeded `gst2bRecords` feed for 2B reconciliation — all computed on demand, same pattern as reports.ts. */
import type { z } from 'zod';
import { gstr1B2bSummary, gstr1B2cSummary, gstr1HsnSummary, gstr2bMismatch, gstr3bTable, type BookPurchaseRow, type GstPurchaseRow, type GstSaleRow, type Gstr2bRow } from '@texafashions/domain';
import type { Gstr1ReportInput, Gstr2bMismatchReportInput, Gstr3bReportInput } from '@texafashions/types';
import { col, db, type Caller } from '../admin';
import { getMasterDocs, requireRoles } from '../engine';

type Doc = Record<string, any>;
const HQ_FIN = ['cfo', 'super_admin', 'auditor'] as const;

function monthRange(period?: string | null) {
  const p = period ?? new Date().toISOString().slice(0, 7);
  const [y, m] = p.split('-').map(Number) as [number, number];
  const nextY = m === 12 ? y + 1 : y; const nextM = m === 12 ? 1 : m + 1;
  return { period: p, start: `${p}-01`, end: `${nextY}-${String(nextM).padStart(2, '0')}-01` };
}

/** Sale invoices (store POS) for the period, one row per line item. */
async function salesRows(start: string, end: string): Promise<GstSaleRow[]> {
  const snap = await col('sales').where('createdAtServer', '>=', new Date(start)).where('createdAtServer', '<', new Date(end)).get();
  const rows: GstSaleRow[] = [];
  snap.docs.forEach((d) => {
    const s = d.data() as Doc; if (s.status === 'voided') return;
    const state = (s.storeGstin as string | undefined)?.slice(0, 2) ?? 'KA';
    for (const l of s.lines as Doc[]) {
      rows.push({ invoiceNo: s.invoiceNo, invoiceDate: s.createdAt?.toDate?.().toISOString().slice(0, 10) ?? '', channel: 'store', placeOfSupplyState: state, customerGstin: null, hsn: l.hsn ?? 'NA', gstRate: l.gstRate, qty: l.qty, taxablePaise: l.taxablePaise, cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise });
    }
  });
  return rows;
}

/** Web orders (ecommerce, B2C, always inter-state from the single central warehouse) for the period. */
async function webOrderRows(start: string, end: string): Promise<GstSaleRow[]> {
  const snap = await col('webOrders').where('createdAt', '>=', start).where('createdAt', '<', end).get();
  const { splitGst } = await import('@texafashions/domain');
  const rows: GstSaleRow[] = [];
  snap.docs.forEach((d) => {
    const o = d.data() as Doc; if (o.status === 'cancelled') return;
    const state = o.shipTo?.state ?? 'KA';
    for (const l of o.lines as Doc[]) {
      const taxable = Math.round((l.netPaise * 100) / (100 + l.gstRate));
      const g = splitGst(taxable, l.gstRate, false); // inter-state: single central warehouse ships pan-India
      rows.push({ invoiceNo: o.orderName ?? d.id, invoiceDate: String(o.createdAt).slice(0, 10), channel: 'web', placeOfSupplyState: state, customerGstin: null, hsn: l.hsn ?? 'NA', gstRate: l.gstRate, qty: l.qty, taxablePaise: taxable, cgstPaise: g.cgstPaise, sgstPaise: g.sgstPaise, igstPaise: g.igstPaise });
    }
  });
  return rows;
}

/** Purchase invoices don't store GSTIN/intra-state directly — joined from the vendor master and the source PO. */
async function invoicesWithContext(start: string, end: string) {
  const snap = await col('purchaseInvoices').where('invoiceDate', '>=', start).where('invoiceDate', '<', end).get();
  const invs: Doc[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Doc) }));
  const [vendors, poSnaps] = await Promise.all([
    getMasterDocs<Doc>('vendors', invs.map((i) => i.vendorId)),
    invs.length ? db.getAll(...invs.map((i) => col('purchaseOrders').doc(i.poId))) : Promise.resolve([]),
  ]);
  const intraByPo = new Map(poSnaps.map((s) => [s.id, !!s.data()?.intraState]));
  return invs.map((inv) => ({ inv, vendorGstin: vendors.get(inv.vendorId)?.gstin ?? null, intraState: intraByPo.get(inv.poId) ?? false }));
}

async function purchaseRows(start: string, end: string): Promise<GstPurchaseRow[]> {
  const rows = await invoicesWithContext(start, end);
  return rows.map(({ inv, vendorGstin, intraState }) => { const tax = inv.taxPaise ?? 0; const half = Math.floor(tax / 2); return { vendorGstin, taxablePaise: inv.taxablePaise ?? 0, cgstPaise: intraState ? half : 0, sgstPaise: intraState ? tax - half : 0, igstPaise: intraState ? 0 : tax }; });
}

// ───────────────────────── GSTR-1
export async function gstr1Report(c: Caller, i: z.output<typeof Gstr1ReportInput>) {
  requireRoles(c, ...HQ_FIN);
  const { period, start, end } = monthRange(i.period);
  const rows = [...(await salesRows(start, end)), ...(await webOrderRows(start, end))];
  return { period, b2c: gstr1B2cSummary(rows), b2b: gstr1B2bSummary(rows), hsn: gstr1HsnSummary(rows), generatedAt: new Date().toISOString() };
}

// ───────────────────────── GSTR-3B
export async function gstr3bReport(c: Caller, i: z.output<typeof Gstr3bReportInput>) {
  requireRoles(c, ...HQ_FIN);
  const { period, start, end } = monthRange(i.period);
  const sales = [...(await salesRows(start, end)), ...(await webOrderRows(start, end))];
  const purchases = await purchaseRows(start, end);
  return { period, table: gstr3bTable(sales, purchases), generatedAt: new Date().toISOString() };
}

// ───────────────────────── GSTR-2B mismatch
export async function gstr2bMismatchReport(c: Caller, i: z.output<typeof Gstr2bMismatchReportInput>) {
  requireRoles(c, ...HQ_FIN);
  const { period, start, end } = monthRange(i.period);
  const [invoices, gstr2bSnap] = await Promise.all([invoicesWithContext(start, end), col('gst2bRecords').where('period', '==', period).get()]);
  const books: BookPurchaseRow[] = invoices.filter((r) => r.vendorGstin).map(({ inv, vendorGstin }) => ({ vendorGstin: vendorGstin!, invoiceNo: inv.invoiceNo, invoiceDate: inv.invoiceDate, taxablePaise: inv.taxablePaise ?? 0, taxPaise: inv.taxPaise ?? 0 }));
  const gstr2b: Gstr2bRow[] = gstr2bSnap.docs.map((d) => d.data() as Gstr2bRow);
  return { period, rows: gstr2bMismatch(books, gstr2b), generatedAt: new Date().toISOString() };
}
