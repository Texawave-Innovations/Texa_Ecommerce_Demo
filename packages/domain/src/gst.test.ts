import { describe, expect, it } from 'vitest';
import { gstr1B2cSummary, gstr1HsnSummary, gstr2bMismatch, gstr3bTable } from './gst';

const ROW = { invoiceNo: 'INV-1', invoiceDate: '2026-11-01', channel: 'store' as const, placeOfSupplyState: 'KA', hsn: '6109', gstRate: 18, qty: 2, taxablePaise: 100000, cgstPaise: 9000, sgstPaise: 9000, igstPaise: 0 };

describe('gst — GSTR-1', () => {
  it('groups B2C rows by state + rate and skips B2B (GSTIN-carrying) rows', () => {
    const b2c = gstr1B2cSummary([ROW, { ...ROW, customerGstin: '29ABCDE1234F1Z5' }]);
    expect(b2c).toHaveLength(1);
    expect(b2c[0]).toMatchObject({ placeOfSupplyState: 'KA', gstRate: 18, taxablePaise: 100000 });
  });
  it('rolls HSN summary across channels', () => {
    const hsn = gstr1HsnSummary([ROW, { ...ROW, channel: 'web', taxablePaise: 50000, cgstPaise: 4500, sgstPaise: 4500 }]);
    expect(hsn[0]).toMatchObject({ hsn: '6109', totalQty: 4, taxablePaise: 150000, totalTaxPaise: 27000 });
  });
});

describe('gst — GSTR-3B', () => {
  it('nets ITC against output tax per head', () => {
    const t = gstr3bTable([ROW], [{ vendorGstin: '29VEND0001A1Z5', taxablePaise: 40000, cgstPaise: 3600, sgstPaise: 3600, igstPaise: 0 }]);
    expect(t.outwardTaxableSupplies.cgstPaise).toBe(9000);
    expect(t.netTaxPayable.cgstPaise).toBe(5400);
  });
});

describe('gst — 2B mismatch', () => {
  it('flags matched, value-mismatched and missing invoices', () => {
    const books = [
      { vendorGstin: 'G1', invoiceNo: 'V-1', invoiceDate: '2026-11-01', taxablePaise: 10000, taxPaise: 1800 },
      { vendorGstin: 'G1', invoiceNo: 'V-2', invoiceDate: '2026-11-02', taxablePaise: 20000, taxPaise: 3600 },
      { vendorGstin: 'G1', invoiceNo: 'V-3', invoiceDate: '2026-11-03', taxablePaise: 5000, taxPaise: 900 },
    ];
    const gstr2b = [
      { vendorGstin: 'G1', invoiceNo: 'V-1', invoiceDate: '2026-11-01', taxablePaise: 10000, taxPaise: 1800 },
      { vendorGstin: 'G1', invoiceNo: 'V-2', invoiceDate: '2026-11-02', taxablePaise: 20000, taxPaise: 3000 },
      { vendorGstin: 'G1', invoiceNo: 'V-4', invoiceDate: '2026-11-04', taxablePaise: 7000, taxPaise: 1260 },
    ];
    const rows = gstr2bMismatch(books, gstr2b);
    expect(rows.find((r) => r.invoiceNo === 'V-1')?.status).toBe('matched');
    expect(rows.find((r) => r.invoiceNo === 'V-2')?.status).toBe('value_mismatch');
    expect(rows.find((r) => r.invoiceNo === 'V-3')?.status).toBe('missing_in_2b');
    expect(rows.find((r) => r.invoiceNo === 'V-4')?.status).toBe('missing_in_books');
  });
});
