/** Phase 5 seed: backfills GL journals for every GRN/purchase invoice/payment/transfer the SCM scenarios already created, and seeds a monthly sales budget per store. The functions-emulator triggers post these live too — this backfill makes the demo correct even if seeding ever runs ahead of the emulator's trigger watchers. */
import { ORG_ID } from '@texafashions/types';
import type { Firestore } from 'firebase-admin/firestore';

export async function seedFinance(db: Firestore, storeCodes: string[]) {
  const Fin = await import('../../../functions/src/finance/triggers');
  const col = (c: string) => db.collection(`orgs/${ORG_ID}/${c}`);
  const log = (m: string) => console.log('  · ' + m);

  const backfill = async (coll: string, fn: (id: string) => Promise<{ posted?: boolean; skipped?: boolean }>) => {
    const snap = await col(coll).get();
    let posted = 0;
    for (const d of snap.docs) { const r = await fn(d.id); if (r.posted) posted++; }
    log(`${coll}: ${posted}/${snap.size} journals posted`);
  };
  await backfill('grns', Fin.postGrnJournalNow);
  await backfill('purchaseInvoices', Fin.postPurchaseInvoiceJournalNow);
  await backfill('paymentVouchers', Fin.postPaymentVoucherJournalNow);
  await backfill('stockTransfers', Fin.postStockTransferJournalNow);

  // A modest sales budget per store for the current and previous month, so Budget vs Actual has something to compare against.
  const period = (monthsAgo: number) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - monthsAgo); return d.toISOString().slice(0, 7); };
  const batch = db.batch();
  storeCodes.forEach((storeId, i) => {
    const salesBudgetPaise = (700000 + (i % 4) * 150000) * 100; // ₹7–11.5L/month, varied by store
    for (const monthsAgo of [0, 1]) {
      const p = period(monthsAgo);
      batch.set(col('budgets').doc(`${storeId}_${p}`), { storeId, period: p, salesBudgetPaise, updatedBy: 'seed' });
    }
  });
  await batch.commit();
  log(`budgets: ${storeCodes.length * 2} store-months`);

  // Mock GSTR-2B feed, derived from the purchase invoices the SCM scenarios already created — some mutated to exercise
  // the 2B mismatch screen (value mismatch, missing in 2B, missing in books) rather than matching 100% of the time.
  const vendors = new Map((await col('vendors').get()).docs.map((d) => [d.id, d.data()]));
  const invSnap = await col('purchaseInvoices').get();
  const withGstin = invSnap.docs.filter((d) => vendors.get(d.get('vendorId'))?.gstin);
  const g2bBatch = db.batch();
  let seeded = 0;
  withGstin.forEach((d, i) => {
    if (i % 5 === 4) return; // 1 in 5: left out of the 2B feed → "missing in 2B"
    const inv = d.data();
    const vendorGstin = vendors.get(inv.vendorId)!.gstin as string;
    const mismatch = i % 3 === 2; // 1 in 3 (of the rest): vendor under-reported the tax → "value mismatch"
    const taxPaise = mismatch ? Math.round((inv.taxPaise ?? 0) * 0.9) : inv.taxPaise ?? 0;
    g2bBatch.set(col('gst2bRecords').doc(`${vendorGstin}_${String(inv.invoiceNo).replace(/\//g, '-')}`), { vendorGstin, invoiceNo: inv.invoiceNo, invoiceDate: inv.invoiceDate, period: String(inv.invoiceDate).slice(0, 7), taxablePaise: inv.taxablePaise ?? 0, taxPaise });
    seeded++;
  });
  if (withGstin[0]) {
    const inv = withGstin[0].data(); const vendorGstin = vendors.get(inv.vendorId)!.gstin as string;
    g2bBatch.set(col('gst2bRecords').doc(`${vendorGstin}_PHANTOM-01`), { vendorGstin, invoiceNo: 'PHANTOM-01', invoiceDate: inv.invoiceDate, period: String(inv.invoiceDate).slice(0, 7), taxablePaise: 15000, taxPaise: 2700 }); // filed by the vendor, never recorded in our books → "missing in books"
    seeded++;
  }
  await g2bBatch.commit();
  log(`gst2bRecords: ${seeded} records seeded (from ${withGstin.length} GSTIN-bearing purchase invoices)`);
}
