import { describe, expect, it } from 'vitest';
import {
  buildGiftCardRedeemJournal, buildGiftCardSaleJournal, buildGrnJournal, buildJournal, buildPurchaseInvoiceJournal,
  buildStockTransferJournal, buildVendorPaymentJournal, journalBalanced, type JournalLine,
} from './journal';

const balanced = (lines: JournalLine[]) => expect(journalBalanced(lines)).toBe(true);

describe('journal — GRN', () => {
  it('debits inventory, credits GR/IR clearing', () => {
    const j = buildGrnJournal({ valuePaise: 125000 });
    balanced(j);
    expect(j.find((l) => l.ledgerId === 'L-INV')?.drPaise).toBe(125000);
    expect(j.find((l) => l.ledgerId === 'L-GRIR-CLR')?.crPaise).toBe(125000);
  });
});

describe('journal — purchase invoice', () => {
  it('splits intra-state tax into CGST/SGST and clears GR/IR', () => {
    const j = buildPurchaseInvoiceJournal({ taxablePaise: 100000, taxPaise: 18000, totalPaise: 118000, intraState: true });
    balanced(j);
    expect(j.find((l) => l.ledgerId === 'L-CGST-IN')?.drPaise).toBe(9000);
    expect(j.find((l) => l.ledgerId === 'L-SGST-IN')?.drPaise).toBe(9000);
    expect(j.find((l) => l.ledgerId === 'L-AP')?.crPaise).toBe(118000);
  });
  it('books IGST for inter-state invoices', () => {
    const j = buildPurchaseInvoiceJournal({ taxablePaise: 100000, taxPaise: 18000, totalPaise: 118000, intraState: false });
    balanced(j);
    expect(j.find((l) => l.ledgerId === 'L-IGST-IN')?.drPaise).toBe(18000);
    expect(j.some((l) => l.ledgerId === 'L-CGST-IN')).toBe(false);
  });
});

describe('journal — vendor payment', () => {
  it('clears AP, pays the bank, withholds TDS', () => {
    const j = buildVendorPaymentJournal({ amountPaise: 100000, tdsPaise: 2000, netPaise: 98000, bankLedgerId: 'L-BANK-HDFC' });
    balanced(j);
    expect(j.find((l) => l.ledgerId === 'L-AP')?.drPaise).toBe(100000);
    expect(j.find((l) => l.ledgerId === 'L-BANK-HDFC')?.crPaise).toBe(98000);
    expect(j.find((l) => l.ledgerId === 'L-TDS')?.crPaise).toBe(2000);
  });
  it('balances with zero TDS', () => balanced(buildVendorPaymentJournal({ amountPaise: 50000, tdsPaise: 0, netPaise: 50000, bankLedgerId: 'L-CASH' })));
});

describe('journal — stock transfer', () => {
  it('moves value into goods-in-transit for an intra-state transfer', () => {
    const j = buildStockTransferJournal({ valuePaise: 40000, interState: false });
    balanced(j);
    expect(j).toHaveLength(2);
  });
  it('self-invoices IGST for an inter-state transfer, netting to zero', () => {
    const j = buildStockTransferJournal({ valuePaise: 40000, interState: true, igstPaise: 7200 });
    balanced(j);
    expect(j.find((l) => l.ledgerId === 'L-IGST-IN')?.drPaise).toBe(7200);
    expect(j.find((l) => l.ledgerId === 'L-IGST-OUT')?.crPaise).toBe(7200);
  });
});

describe('journal — gift cards', () => {
  it('sale: debits tender, credits the liability', () => {
    const j = buildGiftCardSaleJournal(50000, 'UPI', 'GC-001');
    balanced(j);
    expect(j.find((l) => l.ledgerId === 'L-UPI-CLR')?.drPaise).toBe(50000);
    expect(j.find((l) => l.ledgerId === 'L-GC-LIAB')?.crPaise).toBe(50000);
  });
  it('redeem for cash: debits the liability, credits cash', () => {
    const j = buildGiftCardRedeemJournal(20000, 'GC-001');
    balanced(j);
    expect(j.find((l) => l.ledgerId === 'L-CASH')?.crPaise).toBe(20000);
  });
});

describe('buildJournal dispatcher', () => {
  it('routes a grn event', () => {
    const j = buildJournal({ kind: 'grn', input: { valuePaise: 1000 } });
    balanced(j);
  });
  it('rejects an unbalanced journal', () => {
    expect(() => buildJournal({ kind: 'vendorPayment', input: { amountPaise: 100, tdsPaise: 0, netPaise: 99, bankLedgerId: 'L-CASH' } })).toThrow(/Unbalanced/);
  });
});
