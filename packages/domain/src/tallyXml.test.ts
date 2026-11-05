import { describe, expect, it } from 'vitest';
import type { InvoiceTotals } from './invoice';
import { buildJournal } from './journal';
import { buildPurchaseVoucherXml, buildSalesVoucherXml, buildTallyEnvelope, buildTallyVoucher } from './tallyXml';

const SALE_INVOICE: InvoiceTotals = {
  lines: [], taxSummary: [{ gstRate: 18, taxablePaise: 100000, cgstPaise: 9000, sgstPaise: 9000, igstPaise: 0 }],
  grossPaise: 118000, discountPaise: 0, netPaise: 118000, taxablePaise: 100000, cgstPaise: 9000, sgstPaise: 9000, igstPaise: 0,
  totalTaxPaise: 18000, roundOffPaise: 0, payablePaise: 118000,
};

describe('tallyXml — sales voucher', () => {
  it('wraps a balanced sale journal in a Sales voucher with one ledger entry per journal line', () => {
    const lines = buildJournal({ kind: 'sale', invoice: SALE_INVOICE, tenders: [{ mode: 'CASH', amountPaise: 118000 }], cogsPaise: 60000 });
    const xml = buildSalesVoucherXml('Texa Fashions', '2026-11-05', 'BLR-FS/26-27/00001', 'POS sale', lines, { 'L-CASH': 'Cash', 'L-SALES': 'Sales A/c', 'L-CGST-OUT': 'Output CGST', 'L-SGST-OUT': 'Output SGST' });
    expect(xml).toContain('VCHTYPE="Sales"');
    expect(xml).toContain('<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>');
    expect((xml.match(/<ALLLEDGERENTRIES\.LIST>/g) ?? []).length).toBe(lines.length);
    expect(xml).toContain('<DATE>20261105</DATE>');
  });
});

describe('tallyXml — purchase voucher', () => {
  it('resolves ledger names and balances debits against credits', () => {
    const lines = buildJournal({ kind: 'purchaseInvoice', input: { taxablePaise: 100000, taxPaise: 18000, totalPaise: 118000, intraState: true } });
    const xml = buildPurchaseVoucherXml('Texa Fashions', '2026-11-01', 'PI-1', 'Purchase invoice', lines, { 'L-GRIR-CLR': 'GR/IR Clearing', 'L-CGST-IN': 'Input CGST', 'L-SGST-IN': 'Input SGST', 'L-AP': 'Sundry Creditors' });
    expect(xml).toContain('Input CGST');
    expect(xml).toContain('Input SGST');
    expect(xml).toContain('Sundry Creditors');
    const amounts = [...xml.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) => Number(m[1]));
    expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 5);
  });
});

describe('tallyXml — envelope structure', () => {
  it('produces a well-formed Import Data envelope and escapes special characters in narration', () => {
    const v = buildTallyVoucher({ voucherType: 'Journal', date: '2026-11-05', voucherNumber: 'JRN-1', narration: 'Transfer & "adjustment" <demo>', lines: [{ ledgerId: 'L-A', drPaise: 1000, crPaise: 0 }, { ledgerId: 'L-B', drPaise: 0, crPaise: 1000 }] });
    const xml = buildTallyEnvelope('Texa Fashions', [v]);
    expect(xml.startsWith('<ENVELOPE>')).toBe(true);
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(xml).toContain('Transfer &amp; &quot;adjustment&quot; &lt;demo&gt;');
    expect(xml).toContain('<SVCURRENTCOMPANY>Texa Fashions</SVCURRENTCOMPANY>');
  });
});
