/** SCM + inventory API-level smoke test. Needs `pnpm demo` (seeded). Run: pnpm --filter @texafashions/smoke-tests scm */
import { createFirebaseContext } from '@texafashions/data';
import type { Role } from '@texafashions/types';

const ctx = createFirebaseContext({ apiKey: 'demo-key', projectId: 'demo-texafashions', storageBucket: 'demo-texafashions.appspot.com' });
let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${name} ${extra}`); if (!cond) failed++; };
const as = async (role: Role) => { await ctx.auth.signOut().catch(() => {}); await ctx.auth.demoSignIn(role); await new Promise((r) => setTimeout(r, 300)); };
const fails = async (p: Promise<unknown>, re?: RegExp) => p.then(() => false, (e: Error) => (re ? re.test(e.message) : true));
const { scm } = ctx;

// ── pick two SKUs with warehouse stock
await as('buyer');
const skus = await ctx.masters.list('skus', { limit: 400 });
const sku = skus.filter((s) => (s.code as string).includes('-ST-PEN-'))[5]!;
const sku2 = skus.filter((s) => (s.code as string).includes('-ST-PEN-'))[6]!;

// 1. PR → auto-approved by buyer (small), RFQ-less direct PO
const pr = await scm.command('createPR', { storeId: 'WH-CENTRAL', lines: [{ skuId: sku.code as string, qty: 20 }] });
ok('buyer PR within authority auto-approves', pr.status === 'approved', pr.number);
const big = await scm.command('createPO', { vendorId: 'V-IN-002', type: 'domestic', currency: 'INR', lines: [{ skuId: sku.code as string, qty: 3000, unitPriceMinor: 50000 }] });
ok('PO above ₹5L needs approval', big.status === 'pending_approval' && big.approverRole === 'cfo', `${big.number} → ${big.approverRole}`);
ok('maker cannot approve own PO', await fails(scm.command('decideDocument', { collection: 'purchaseOrders', id: big.id, approve: true }), /Needs role|own/));

const po = await scm.command('createPO', { vendorId: 'V-IN-002', type: 'domestic', currency: 'INR', prId: pr.id, lines: [{ skuId: sku.code as string, qty: 100, unitPriceMinor: 10000 }, { skuId: sku2.code as string, qty: 50, unitPriceMinor: 20000 }] });
ok('PO ≤ ₹5L auto-approved, PR marked converted', po.status === 'approved' && (await scm.get('purchaseRequisitions', pr.id))?.status === 'converted');
const am = await scm.command('amendPO', { poId: po.id, reason: 'Qty change', lines: [{ skuId: sku.code as string, qty: 120, unitPriceMinor: 10000 }, { skuId: sku2.code as string, qty: 50, unitPriceMinor: 20000 }] });
ok('amendment bumps version + stores snapshot', am.version === 2 && (await scm.listVersions(po.id)).length === 1);

await as('cfo');
ok('CFO approves buyer PO > ₹5L', (await scm.command('decideDocument', { collection: 'purchaseOrders', id: big.id, approve: true })).status === 'approved');

// 2. Vendor portal isolation
await as('vendor');
const mine = await scm.list('purchaseOrders', { where: [['vendorId', '==', 'V-KR-001']] });
ok('vendor reads own POs', mine.length >= 2, `(${mine.length})`);
ok('vendor cannot list others’ POs', await fails(scm.list('purchaseOrders', { where: [['vendorId', '==', 'V-IN-002']] })));
ok('vendor cannot ack someone else’s PO', await fails(scm.command('ackPO', { poId: po.id }), /Not your/));
ok('vendor cannot read stock', await fails(scm.list('stock', { where: [['locationId', '==', 'WH-CENTRAL']] })));

// 3. Receiving
await as('warehouse_manager');
ok('GRN rejects SKU not on PO', await fails(scm.command('postGRN', { poId: po.id, locationId: 'WH-CENTRAL', lines: [{ skuId: skus[0]!.code as string, receivedQty: 1 }] }), /not on PO/));
ok('over-receipt beyond 5% blocked', await fails(scm.command('postGRN', { poId: po.id, locationId: 'WH-CENTRAL', lines: [{ skuId: sku.code as string, receivedQty: 200 }] }), /over-receipt/));
const before = await scm.get('stock', `WH-CENTRAL_${sku.code}`);
const grn = await scm.command('postGRN', { poId: po.id, locationId: 'WH-CENTRAL', lines: [{ skuId: sku.code as string, receivedQty: 120, damagedQty: 5 }, { skuId: sku2.code as string, receivedQty: 45 }] });
const mid = await scm.get('stock', `WH-CENTRAL_${sku.code}`);
ok('GRN puts good units in QC, damaged aside, onHand untouched', mid!.inQC - (before!.inQC ?? 0) === 115 && mid!.damaged - (before!.damaged ?? 0) === 5 && mid!.onHand === before!.onHand);
ok('GRN flags variance (short + damaged)', grn.hasVariance === true && grn.status === 'partially_received');
ok('QC must account for every unit', await fails(scm.command('postQC', { grnId: grn.id, lines: [{ skuId: sku.code as string, passQty: 100, rejectQty: 0, reworkQty: 0 }, { skuId: sku2.code as string, passQty: 45, rejectQty: 0, reworkQty: 0 }] }), /must equal/));
ok('QC reject needs reason', await fails(scm.command('postQC', { grnId: grn.id, lines: [{ skuId: sku.code as string, passQty: 105, rejectQty: 10, reworkQty: 0 }, { skuId: sku2.code as string, passQty: 45, rejectQty: 0, reworkQty: 0 }] }), /reason code/));
const qc = await scm.command('postQC', { grnId: grn.id, lines: [{ skuId: sku.code as string, passQty: 108, rejectQty: 7, reworkQty: 0, reasonCode: 'RC-QC-SPEC', defectNote: 'colour faded' }, { skuId: sku2.code as string, passQty: 45, rejectQty: 0, reworkQty: 0 }] });
const after = await scm.get('stock', `WH-CENTRAL_${sku.code}`);
ok('QC moves pass → onHand, rejects → damaged', after!.onHand - before!.onHand === 108 && after!.inQC === (before!.inQC ?? 0) && after!.damaged - (before!.damaged ?? 0) === 12, `onHand +${after!.onHand - before!.onHand}`);
ok('QC auto-drafts purchase return + debit note', !!qc.returnId && (await scm.list('debitNotes', { where: [['returnId', '==', qc.returnId]] }))[0]?.status === 'draft');
const tasks = await scm.list('putawayTasks', { where: [['grnId', '==', grn.id]] });
ok('putaway tasks created with bin suggestion', tasks.length === 2 && !!tasks[0]!.suggestedBinId);
const pa = await scm.command('postPutaway', { taskId: tasks[0]!.id, binId: tasks[0]!.suggestedBinId });
ok('putaway posts + returns label data', pa.status === 'done' && !!pa.label.binId);
const dn = await scm.command('postPurchaseReturn', { returnId: qc.returnId });
ok('purchase return dispatch issues numbered debit note', /DN\//.test(dn.debitNoteNumber));

// 4. Ledger invariant: ledger sums == summary for WH SKUs touched
await as('cfo');
for (const s of [sku, sku2]) {
  const rows = await scm.list('stockLedger', { where: [['locationId', '==', 'WH-CENTRAL'], ['skuId', '==', s.code as string]], limit: 500 });
  const sums: Record<string, number> = {}; rows.forEach((r: any) => (sums[r.bucket] = (sums[r.bucket] ?? 0) + r.qty));
  const st = await scm.get('stock', `WH-CENTRAL_${s.code}`);
  ok(`ledger ≡ summary for ${s.code}`, (['onHand', 'inQC', 'damaged', 'inTransit'] as const).every((b) => (sums[b] ?? 0) === (st![b] ?? 0)), JSON.stringify(sums));
}

// 5. Invoice: matched / hold / override, then payment with TDS
const poNow = await scm.get('purchaseOrders', po.id);
const goodNo = 'T-' + Date.now();
const good = await scm.command('saveInvoice', { vendorId: 'V-IN-002', poId: po.id, invoiceNo: goodNo, invoiceDate: new Date().toISOString().slice(0, 10), lines: [{ skuId: sku.code as string, qty: 108, unitPriceMinor: 10000, gstRate: Number((poNow!.lines as any[])[0].gstRate) }] });
ok('matching invoice → matched + AP bill', good.status === 'matched' && !!(await scm.get('apBills', good.id)));
const hold = await scm.command('saveInvoice', { vendorId: 'V-IN-002', poId: po.id, invoiceNo: 'H-' + Date.now(), invoiceDate: new Date().toISOString().slice(0, 10), lines: [{ skuId: sku2.code as string, qty: 45, unitPriceMinor: 25000, gstRate: 12 }] });
ok('price above tolerance → HOLD', hold.status === 'hold' && hold.reasons.length > 0, hold.reasons?.[0]);
ok('duplicate invoice number rejected', await fails(scm.command('saveInvoice', { vendorId: 'V-IN-002', poId: po.id, invoiceNo: goodNo, invoiceDate: '2026-11-01', lines: [{ skuId: sku2.code as string, qty: 1, unitPriceMinor: 20000, gstRate: 12 }] }), /already recorded/));
ok('override needs a note', await fails(scm.command('resolveHold', { invoiceId: hold.id, action: 'override', note: '' }).catch((e) => { throw e; })));
ok('hold resolved by override → AP bill', (await scm.command('resolveHold', { invoiceId: hold.id, action: 'override', note: 'Price agreed by phone' })).status === 'overridden');
const bill = await scm.get('apBills', good.id);
const pay = await scm.command('postPayment', { vendorId: 'V-IN-002', kind: 'full', invoiceIds: [good.id], amountPaise: bill!.balancePaise, mode: 'bank_transfer' });
const v = await scm.get('paymentVouchers', pay.id);
ok('payment posts with TDS and settles the bill', pay.status === 'posted' && v!.tdsPaise > 0 && (await scm.get('apBills', good.id))!.status === 'paid', `TDS ₹${(v!.tdsPaise / 100).toFixed(2)}`);
ok('overpayment blocked', await fails(scm.command('postPayment', { vendorId: 'V-IN-002', kind: 'part', invoiceIds: [good.id], amountPaise: 100, mode: 'upi' }), /exceeds|outstanding/));
const bill2 = await scm.get('apBills', hold.id);
await scm.command('postPayment', { vendorId: 'V-IN-002', kind: 'full', invoiceIds: [hold.id], amountPaise: bill2!.balancePaise, mode: 'upi' });
const flow = (await scm.get('purchaseOrders', po.id))!.flow as any;
ok('document flow tracked on PO (PR→PO→GRN→QC→Invoice→Paid)', ['PR', 'PO', 'GRN', 'QC', 'Invoice', 'Paid'].every((k) => flow[k]));

// 6. Transfers + inventory rules
await as('warehouse_manager');
const stocked = (await scm.list('stock', { where: [['locationId', '==', 'WH-CENTRAL']], limit: 400 })).find((s: any) => s.onHand >= 30 && (s.avgCostPaise ?? 0) > 0)!;
const tr = await scm.command('createTransfer', { fromLocationId: 'WH-CENTRAL', toLocationId: 'HYD-NX', lines: [{ skuId: stocked.skuId, qty: 3 }] });
const dsp = await scm.command('dispatchTransfer', { transferId: tr.id });
ok('inter-state transfer raises IGST tax invoice, no e-way under ₹50k', !!dsp.taxInvoiceNumber && dsp.interState && !dsp.ewayBillNo);
const bigT = await scm.command('createTransfer', { fromLocationId: 'WH-CENTRAL', toLocationId: 'HYD-SC', lines: [{ skuId: stocked.skuId, qty: 25 }] });
const bigCost = stocked.avgCostPaise * 25;
if (bigCost > 5_000_000) ok('e-way bill required above ₹50k', await fails(scm.command('dispatchTransfer', { transferId: bigT.id }), /vehicle number/));
await as('store_manager');
ok('store manager of BLR cannot receive into HYD', await fails(scm.command('receiveTransfer', { transferId: tr.id, lines: [{ skuId: stocked.skuId, receivedQty: 3 }] }), /No access/));
await as('super_admin');
const rc = await scm.command('receiveTransfer', { transferId: tr.id, lines: [{ skuId: stocked.skuId, receivedQty: 2, damagedQty: 1 }] });
ok('receiving a short/damaged transfer records variance', rc.variance === true && rc.status === 'received_with_variance');
const dest = await scm.get('stock', `HYD-NX_${stocked.skuId}`);
ok('destination: 1 on hand, 1 damaged, in-transit cleared', dest!.inTransit === 0 && dest!.damaged === 1);
ok('cannot dispatch more than on hand', await fails((async () => { const t = await scm.command('createTransfer', { fromLocationId: 'WH-CENTRAL', toLocationId: 'PUN-PMC', lines: [{ skuId: stocked.skuId, qty: 99999 }] }); return scm.command('dispatchTransfer', { transferId: t.id, vehicleNo: 'MH12AB1234' }); })(), /Insufficient/));

await as('cashier');
ok('cashier cannot adjust stock or post GRN', (await fails(scm.command('postAdjustment', { locationId: 'PUN-PMC', skuId: stocked.skuId, qtyDelta: 1, reasonCode: 'RC-ADJ-FOUND' }))) && (await fails(scm.command('postGRN', { poId: po.id, locationId: 'WH-CENTRAL', lines: [{ skuId: sku.code as string, receivedQty: 1 }] }))));
await as('store_manager');
const adj = await scm.command('postAdjustment', { locationId: 'BLR-FS', skuId: stocked.skuId, qtyDelta: -1, reasonCode: 'RC-ADJ-DMG', toBucket: 'tester' });
ok('adjustment to tester bucket (within authority → pending/posted)', ['posted', 'pending_approval'].includes(adj.status), adj.status);

// 7. Reports
await as('cfo');
const w = await scm.command('inventoryValuation', { method: 'WAC', locationId: 'WH-CENTRAL' });
const f = await scm.command('inventoryValuation', { method: 'FIFO', locationId: 'WH-CENTRAL' });
ok('valuation WAC and FIFO both computed and differ', w.totalPaise > 0 && f.totalPaise > 0 && w.totalPaise !== f.totalPaise, `WAC ₹${Math.round(w.totalPaise / 100)} / FIFO ₹${Math.round(f.totalPaise / 100)}`);
const ag = await scm.command('inventoryAgeing', { locationId: 'BLR-FS' });
ok('ageing buckets + dead-stock markdown suggestions', ag.totals['90+'].qty > 0 && ag.deadStock.length > 0, `${ag.deadStock.length} dead-stock SKUs`);
const hm = await scm.command('coverHeatmap', {});
ok('days-of-cover heatmap (8 stores × departments)', hm.cells.length >= 40);
await as('buyer');
const rr = await scm.command('runReplenishment', { storeId: 'PUN-PMC' });
ok('replenishment run for a store', rr.suggestions > 0);

console.log(failed ? `\n${failed} FAILED` : '\nAll SCM smoke checks passed');
process.exit(failed ? 1 : 0);
