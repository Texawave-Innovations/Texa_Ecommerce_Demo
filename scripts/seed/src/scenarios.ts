/**
 * Seeds open documents at every SCM stage by calling the REAL command handlers (same code the callables run),
 * so every document, ledger row and stock balance is consistent with the engine rules.
 */
import { DEMO_USERS, COMMAND_SCHEMAS, type Role } from '@texafashions/types';
import type { SkuSeed } from './catalogue';

export async function seedScenarios(skus: SkuSeed[]) {
  // Dynamic imports so env vars are set before firebase-admin initialises.
  const P = await import('../../../functions/src/scm/procure');
  const R = await import('../../../functions/src/scm/receiving');
  const A = await import('../../../functions/src/scm/payables');
  const T = await import('../../../functions/src/scm/transfers');
  const I = await import('../../../functions/src/inventory');
  const { col } = await import('../../../functions/src/admin');

  const who = (role: Role, uid?: string) => { const u = DEMO_USERS.find((d) => (uid ? d.uid === uid : d.role === role))!; return { uid: u.uid, name: u.displayName, claims: { role: u.role, storeIds: u.storeIds, approvalLimitPaise: u.approvalLimitPaise, ...(u.vendorId ? { vendorId: u.vendorId } : {}) } }; };
  const buyer = who('buyer'), cfo = who('cfo'), wh = who('warehouse_manager'), sm = who('store_manager'), admin = who('super_admin'), vendor = who('vendor');
  const run = async <K extends keyof typeof COMMAND_SCHEMAS>(h: (c: any, i: any) => Promise<any>, name: K, c: any, input: unknown) => h(c, COMMAND_SCHEMAS[name].parse(input));
  const pick = (sub: string, n: number, from = 0) => skus.filter((s) => s.subCategoryId === sub).slice(from, from + n);
  const lines = (list: SkuSeed[], qty: number, price?: (s: SkuSeed) => number) => list.map((s) => ({ skuId: s.code, qty, unitPriceMinor: price ? price(s) : Math.round(s.costPaise) }));
  const krw = (s: SkuSeed) => Math.round((s.costPaise / 100) * 16 * 100); // minor = major×100 ; ₹→won ≈ ×16
  const cny = (s: SkuSeed) => Math.round((s.costPaise / 100) / 11.7 * 100);
  const ymd = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const log = (m: string) => console.log('  · ' + m);

  // ── Replenishment (scheduled-function core)
  const rep = await P.runReplenishmentCore(P.SYSTEM, {});
  log(`replenishment: ${rep.suggestions} suggestions (${rep.critical} critical)`);

  // ── PRs
  const prSmall = await run(P.createPR, 'createPR', buyer, { storeId: 'WH-CENTRAL', lines: pick('PL-SML', 3).map((s) => ({ skuId: s.code, qty: 40 })), notes: 'Replenish plush for festive' });
  const prSm = await run(P.createPR, 'createPR', sm, { storeId: 'BLR-FS', lines: pick('BG-TOT', 2).map((s) => ({ skuId: s.code, qty: 150 })), notes: 'Store indent — needs approval' });
  const prRfq = await run(P.createPR, 'createPR', buyer, { storeId: 'WH-CENTRAL', lines: pick('ST-NTB', 3).map((s) => ({ skuId: s.code, qty: 60 })), notes: 'Notebook back-to-school' });
  log(`PRs ${prSmall.number} (${prSmall.status}), ${prSm.number} (${prSm.status}), ${prRfq.number} (${prRfq.status})`);

  // ── RFQ with 3 quotes (open, ready to award)
  const rfq = await run(R_(P.createRFQ), 'createRFQ', buyer, { prId: prRfq.id, vendorIds: ['V-KR-002', 'V-CN-001', 'V-IN-002'] });
  const nb = pick('ST-NTB', 3);
  await run(P.submitQuotation, 'submitQuotation', buyer, { rfqId: rfq.id, vendorId: 'V-KR-002', currency: 'KRW', leadTimeDays: 35, incoterm: 'FOB', lines: nb.map((s) => ({ skuId: s.code, unitPriceMinor: krw(s) })) });
  await run(P.submitQuotation, 'submitQuotation', buyer, { rfqId: rfq.id, vendorId: 'V-CN-001', currency: 'CNY', leadTimeDays: 45, incoterm: 'CIF', lines: nb.map((s) => ({ skuId: s.code, unitPriceMinor: Math.round(cny(s) * 0.9) })) });
  await run(P.submitQuotation, 'submitQuotation', buyer, { rfqId: rfq.id, vendorId: 'V-IN-002', currency: 'INR', leadTimeDays: 10, lines: nb.map((s) => ({ skuId: s.code, unitPriceMinor: Math.round(s.costPaise * 1.12) })) });
  log(`RFQ ${rfq.number} with 3 quotations`);

  // ── POs at every stage
  const poPending = await run(P.createPO, 'createPO', buyer, { vendorId: 'V-IN-001', type: 'domestic', currency: 'INR', lines: lines(pick('BG-SLG', 4), 700), expectedDate: ymd(-20) });            // > ₹5L → pending (CFO)
  const poSent = await run(P.createPO, 'createPO', buyer, { vendorId: 'V-IN-003', type: 'domestic', currency: 'INR', lines: lines(pick('LF-HAR', 3), 120), expectedDate: ymd(-12) });
  await run(P.sendPO, 'sendPO', buyer, { poId: poSent.id, channel: 'email' });
  const poAwaitAck = await run(P.createPO, 'createPO', buyer, { vendorId: 'V-KR-001', type: 'import', currency: 'KRW', incoterm: 'FOB', lines: lines(pick('PL-LRG', 3), 60, krw), expectedDate: ymd(-30) });
  await run(P.sendPO, 'sendPO', buyer, { poId: poAwaitAck.id, channel: 'whatsapp' });
  const poImport = await run(P.createPO, 'createPO', buyer, { vendorId: 'V-KR-001', type: 'import', currency: 'KRW', incoterm: 'FOB', lines: lines(pick('PL-KEY', 3), 200, krw), expectedDate: ymd(-5) });
  await run(P.sendPO, 'sendPO', buyer, { poId: poImport.id, channel: 'email' });
  await run(P.ackPO, 'ackPO', vendor, { poId: poImport.id, promisedDate: ymd(-4) });
  const asn = await run(P.createASN, 'createASN', vendor, { poId: poImport.id, eta: ymd(-2), awb: 'KE-8841-2201', containerNo: 'MSKU7712345', boxes: 36, lines: pick('PL-KEY', 3).map((s) => ({ skuId: s.code, qty: 200 })) });
  await run(P.saveBillOfEntry, 'saveBillOfEntry', cfo, { poId: poImport.id, asnId: asn.id, beNumber: 'BE-2026-884412', beDate: ymd(0), port: 'JNPT Nhava Sheva', chaId: 'CHA-NHAVA', assessableValuePaise: 6_400_000, bcdPct: 20, swsPct: 10, igstPct: 18, chaChargesPaise: 450_000, otherChargesPaise: 120_000 });
  log(`POs: pending ${poPending.number}, sent ${poSent.number}, awaiting-ack ${poAwaitAck.number}, import+ASN+BoE ${poImport.number}`);

  // helper to take a PO to GRN → QC → putaway
  const receive = async (poId: string, receivedMult = 1, damaged = 0, gate = true) => {
    const po = (await col('purchaseOrders').doc(poId).get()).data()!;
    const ge = gate ? await run(R.createGateEntry, 'createGateEntry', wh, { poId, vendorId: po.vendorId, vehicleNo: 'MH04-AB-' + Math.floor(1000 + Math.random() * 8999), driverName: 'Ramesh Yadav', locationId: 'WH-CENTRAL' }) : null;
    const grn = await run(R.postGRN, 'postGRN', wh, { poId, gateEntryId: ge?.id, locationId: 'WH-CENTRAL', lines: (po.lines as any[]).map((l, i) => ({ skuId: l.skuId, receivedQty: Math.floor(l.qty * receivedMult), damagedQty: i === 0 ? damaged : 0 })) });
    return { grn, po };
  };
  const qcAll = async (grnId: string, rejectFirst = 0) => {
    const g = (await col('grns').doc(grnId).get()).data()!;
    return run(R.postQC, 'postQC', wh, { grnId, lines: (g.lines as any[]).map((l, i) => ({ skuId: l.skuId, passQty: l.goodQty - (i === 0 ? rejectFirst : 0), rejectQty: i === 0 ? rejectFirst : 0, reworkQty: 0, reasonCode: i === 0 && rejectFirst ? 'RC-QC-SPEC' : undefined, defectNote: i === 0 && rejectFirst ? 'Stitching loose on several pieces' : undefined })) });
  };

  // GRN done, QC pending (short receipt + damaged)
  const poQcPending = await run(P.createPO, 'createPO', buyer, { vendorId: 'V-IN-002', type: 'domestic', currency: 'INR', lines: lines(pick('KL-TBL', 3), 90), expectedDate: ymd(-1) });
  const a = await receive(poQcPending.id, 0.8, 4);
  log(`GRN ${a.grn.number} awaiting QC (variance=${a.grn.hasVariance})`);

  // QC done with reject → return draft + debit note draft; putaway tasks (one done)
  const poPutaway = await run(P.createPO, 'createPO', buyer, { vendorId: 'V-IN-004', type: 'domestic', currency: 'INR', lines: lines(pick('ST-PEN', 3), 150), expectedDate: ymd(2) });
  const b = await receive(poPutaway.id);
  const qcb = await qcAll(b.grn.id, 6);
  const tasks = await col('putawayTasks').where('grnId', '==', b.grn.id).get();
  if (tasks.docs[0]) await run(R.postPutaway, 'postPutaway', wh, { taskId: tasks.docs[0].id, binId: tasks.docs[0].get('suggestedBinId') });
  log(`QC done (${qcb.returnNumber ?? 'no return'}), ${tasks.size} putaway tasks (1 done)`);

  // Invoice matched → AP bill open (MSME, due soon) + landed cost
  const poBill = await run(P.createPO, 'createPO', buyer, { vendorId: 'V-IN-001', type: 'domestic', currency: 'INR', lines: lines(pick('BG-PCH', 3), 200), expectedDate: ymd(35) });
  const c1 = await receive(poBill.id); await qcAll(c1.grn.id);
  const poFresh = (await col('purchaseOrders').doc(poBill.id).get()).data()!;
  const inv1 = await run(A.saveInvoice, 'saveInvoice', cfo, { vendorId: 'V-IN-001', poId: poBill.id, invoiceNo: 'MPC/26-27/0412', invoiceDate: ymd(40), lines: (poFresh.lines as any[]).map((l) => ({ skuId: l.skuId, qty: l.acceptedQty, unitPriceMinor: l.unitPriceMinor, gstRate: l.gstRate })) });
  await run(R.postLandedCost, 'postLandedCost', cfo, { poId: poBill.id, grnIds: [c1.grn.id], basis: 'value', charges: [{ type: 'freight inward', amountPaise: 850_00 }, { type: 'unloading', amountPaise: 150_00 }] });
  log(`invoice ${inv1.status} (MSME, ~5 days to 45-day limit) + landed cost`);

  // Invoice on HOLD (price above PO)
  const poHold = await run(P.createPO, 'createPO', buyer, { vendorId: 'V-IN-005', type: 'domestic', currency: 'INR', lines: lines(pick('LF-PHN', 3), 100), expectedDate: ymd(3) });
  const d = await receive(poHold.id); await qcAll(d.grn.id);
  const poH = (await col('purchaseOrders').doc(poHold.id).get()).data()!;
  const inv2 = await run(A.saveInvoice, 'saveInvoice', cfo, { vendorId: 'V-IN-005', poId: poHold.id, invoiceNo: 'DLS-7781', invoiceDate: ymd(3), lines: (poH.lines as any[]).map((l, i) => ({ skuId: l.skuId, qty: l.acceptedQty, unitPriceMinor: i === 0 ? Math.round(l.unitPriceMinor * 1.12) : l.unitPriceMinor, gstRate: l.gstRate })) });
  log(`invoice ${inv2.status}: ${(inv2.reasons ?? []).join('; ')}`);

  // Part-paid + fully paid
  const poPart = await run(P.createPO, 'createPO', buyer, { vendorId: 'V-IN-006', type: 'domestic', currency: 'INR', lines: lines(pick('CR-GRM', 3), 120), expectedDate: ymd(15) });
  const e = await receive(poPart.id); await qcAll(e.grn.id);
  const poE = (await col('purchaseOrders').doc(poPart.id).get()).data()!;
  const inv3 = await run(A.saveInvoice, 'saveInvoice', cfo, { vendorId: 'V-IN-006', poId: poPart.id, invoiceNo: 'NT/1190', invoiceDate: ymd(12), lines: (poE.lines as any[]).map((l) => ({ skuId: l.skuId, qty: l.acceptedQty, unitPriceMinor: l.unitPriceMinor, gstRate: l.gstRate })) });
  await run(A.postPayment, 'postPayment', cfo, { vendorId: 'V-IN-006', kind: 'part', invoiceIds: [inv3.id], amountPaise: Math.floor(inv3.totalPaise / 2), mode: 'bank_transfer', bankAccountId: 'BA-HDFC' });

  const poPaid = await run(P.createPO, 'createPO', buyer, { vendorId: 'V-IN-004', type: 'domestic', currency: 'INR', lines: lines(pick('ST-STK', 3), 100), expectedDate: ymd(30) });
  const f = await receive(poPaid.id); await qcAll(f.grn.id);
  const poF = (await col('purchaseOrders').doc(poPaid.id).get()).data()!;
  const inv4 = await run(A.saveInvoice, 'saveInvoice', cfo, { vendorId: 'V-IN-004', poId: poPaid.id, invoiceNo: 'PPH/3321', invoiceDate: ymd(25), lines: (poF.lines as any[]).map((l) => ({ skuId: l.skuId, qty: l.acceptedQty, unitPriceMinor: l.unitPriceMinor, gstRate: l.gstRate })) });
  await run(A.postPayment, 'postPayment', cfo, { vendorId: 'V-IN-004', kind: 'full', invoiceIds: [inv4.id], amountPaise: inv4.totalPaise, mode: 'bank_transfer', bankAccountId: 'BA-HDFC' });
  log('part-paid and fully-paid POs');

  const whStock = new Map((await col('stock').where('locationId', '==', 'WH-CENTRAL').get()).docs.map((d) => [d.get('skuId') as string, d.get('onHand') as number]));
  const stocked = (sub: string, n: number, min: number) => skus.filter((s) => s.subCategoryId === sub && (whStock.get(s.code) ?? 0) >= min).slice(0, n);
  // ── Transfers: draft, in-transit (inter-state with e-way bill), received with variance
  const tdraft = await run(T.createTransfer, 'createTransfer', wh, { fromLocationId: 'WH-CENTRAL', toLocationId: 'PUN-PMC', lines: stocked('PL-SML', 3, 12).map((s) => ({ skuId: s.code, qty: 12 })) });
  const tInter = await run(T.createTransfer, 'createTransfer', wh, { fromLocationId: 'WH-CENTRAL', toLocationId: 'BLR-FS', lines: stocked('KL-BTL', 3, 40).concat(stocked('PL-LRG', 3, 40)).slice(0, 3).map((s) => ({ skuId: s.code, qty: 40 })) });
  await run(T.dispatchTransfer, 'dispatchTransfer', wh, { transferId: tInter.id, vehicleNo: 'MH12-QR-4410' });
  const varSkus = stocked('PL-KEY', 3, 20);
  const tVar = await run(T.createTransfer, 'createTransfer', wh, { fromLocationId: 'WH-CENTRAL', toLocationId: 'MUM-PMC', lines: varSkus.map((s) => ({ skuId: s.code, qty: 20 })) });
  await run(T.dispatchTransfer, 'dispatchTransfer', wh, { transferId: tVar.id });
  await run(T.receiveTransfer, 'receiveTransfer', admin, { transferId: tVar.id, lines: varSkus.map((s, i) => ({ skuId: s.code, receivedQty: i === 0 ? 18 : 20, damagedQty: i === 1 ? 1 : 0 })) });
  log(`transfers ${tdraft.number} draft, ${tInter.number} in transit (inter-state, e-way), ${tVar.number} received with variance`);

  // ── Inventory: pending adjustment, cycle count in progress
  const adj = await run(I.postAdjustment, 'postAdjustment', sm, { locationId: 'BLR-FS', skuId: pick('PL-SML', 1)[0]!.code, qtyDelta: -3, reasonCode: 'RC-ADJ-THEFT', note: 'Found missing during closing' });
  const cc = await run(I.startCount, 'startCount', sm, { type: 'cycle', locationId: 'BLR-FS', abcClass: 'A', limit: 12 });
  log(`adjustment ${adj.status}, cycle count ${cc.number} (${cc.lines} lines)`);
}
// tiny identity helper so the call sites above read uniformly
function R_<T>(h: T): T { return h; }
