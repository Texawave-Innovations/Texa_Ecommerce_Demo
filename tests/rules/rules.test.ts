import { afterAll, beforeAll, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, setLogLevel, where } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { ROLES, MASTER_KEYS, DEMO_USERS, type Role } from '@texafashions/types';

let env: RulesTestEnvironment;
/** One representative document per Phase 2 collection. */
const OPS_DOCS: [string, string, Record<string, unknown>][] = [
  ['stock', 'WH-CENTRAL_S1', { locationId: 'WH-CENTRAL', skuId: 'S1', onHand: 10 }],
  ['stock', 'BLR-FS_S1', { locationId: 'BLR-FS', skuId: 'S1', onHand: 4 }],
  ['stock', 'HYD-NX_S1', { locationId: 'HYD-NX', skuId: 'S1', onHand: 4 }],
  ['stock', 'PUN-PMC_S1', { locationId: 'PUN-PMC', skuId: 'S1', onHand: 4 }],
  ['stockLedger', 'L1', { locationId: 'WH-CENTRAL', skuId: 'S1', qty: 5 }],
  ['purchaseRequisitions', 'PR-BLR', { storeId: 'BLR-FS', status: 'approved' }],
  ['purchaseRequisitions', 'PR-HYD', { storeId: 'HYD-NX', status: 'approved' }],
  ['purchaseOrders', 'PO-KR', { vendorId: 'V-KR-001', status: 'approved' }],
  ['purchaseOrders', 'PO-IN', { vendorId: 'V-IN-001', status: 'approved' }],
  ['asns', 'ASN-KR', { vendorId: 'V-KR-001' }], ['poAcks', 'ACK-KR', { vendorId: 'V-KR-001' }],
  ['rfqs', 'R1', { x: 1 }], ['quotations', 'Q1', { x: 1 }], ['grns', 'G1', { x: 1 }], ['qcInspections', 'QC1', { x: 1 }], ['putawayTasks', 'PT1', { x: 1 }],
  ['gateEntries', 'GE1', { x: 1 }], ['billsOfEntry', 'B1', { x: 1 }], ['landedCosts', 'LC1', { x: 1 }], ['purchaseInvoices', 'I1', { x: 1 }], ['matchResults', 'M1', { x: 1 }],
  ['paymentVouchers', 'PV1', { x: 1 }], ['apBills', 'AP1', { x: 1 }], ['debitNotes', 'DN1', { x: 1 }], ['purchaseReturns', 'RT1', { x: 1 }], ['ewayBills', 'EW1', { x: 1 }],
  ['stockTransfers', 'T-BLR', { fromLocationId: 'WH-CENTRAL', toLocationId: 'BLR-FS' }],
  ['replenishmentSuggestions', 'RS1', { locationId: 'BLR-FS' }], ['adjustments', 'AD1', { locationId: 'BLR-FS' }], ['cycleCounts', 'CC1', { locationId: 'BLR-FS' }],
  ['counters', 'PO_WH_26-27', { seq: 1 }],
  ['webOrders', 'WO-1', { status: 'allocated', customer: { mobile: '9800000000' } }], ['codRemittances', 'CR-1', { x: 1 }], ['shopifyEvents', 'EV-1', { status: 'processed' }],
  ['failedEvents', 'FE-1', { status: 'retrying', payloadJson: '{}' }], ['stockPushRuns', 'SP-1', { x: 1 }], ['shopifyStock', 'S1', { pushedQty: 3 }], ['syncHealth', 'shopify', { processed: 1 }],
  ['pickLists', 'PL-BLR', { locationId: 'BLR-FS', status: 'open' }], ['pickLists', 'PL-WH', { locationId: 'WH-CENTRAL', status: 'open' }], ['pickLists', 'PL-HYD', { locationId: 'HYD-NX', status: 'open' }],
  ['shipments', 'SHP-WH', { locationId: 'WH-CENTRAL', awb: 'SR1' }], ['rtoCases', 'RTO-WH', { locationId: 'WH-CENTRAL' }],
  ['sales', 'S-PUN', { storeId: 'PUN-PMC', payablePaise: 100 }], ['sales', 'S-BLR', { storeId: 'BLR-FS', payablePaise: 100 }],
  ['shifts', 'SH-PUN', { storeId: 'PUN-PMC', status: 'open' }], ['tills', 'PUN-PMC-T1', { storeId: 'PUN-PMC' }], ['returns', 'R-PUN', { storeId: 'PUN-PMC' }],
  ['zReports', 'Z-PUN', { storeId: 'PUN-PMC' }], ['posOutbox', 'OB-PUN', { storeId: 'PUN-PMC', status: 'pending' }], ['reservations', 'RV-PUN', { storeId: 'PUN-PMC' }],
  ['creditNotes', 'CN-PUN', { storeId: 'PUN-PMC' }], ['giftCards', 'GC-1', { balancePaise: 100 }], ['vouchers', 'V-1', { code: 'V-1' }], ['promotions', 'P-1', { status: 'active' }],
  ['loyaltyLedger', 'LL-1', { points: 1 }], ['posUsers', 'PUN-PMC_CSH01', { pinHash: 'x', salt: 'y' }], ['journals', 'J-1', { x: 1 }], ['salesDailyShards', 'D-1', { x: 1 }],
];
const P = 'orgs/texafashions';

beforeAll(async () => {
  setLogLevel('error');
  env = await initializeTestEnvironment({
    projectId: 'demo-texafashions',
    firestore: { rules: readFileSync('../../firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync('../../storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `${P}/skus/SKU-1`), { name: 'x' });
    await setDoc(doc(db, `${P}/approvals/a1`), { requestedBy: 'demo-buyer', status: 'pending' });
    await setDoc(doc(db, `${P}/auditLogs/l1`), { action: 'x' });
    await setDoc(doc(db, `${P}/stock/WH_SKU-1`), { onHand: 5 });
    for (const [c, id, d] of OPS_DOCS) await setDoc(doc(db, `${P}/${c}/${id}`), d);
  });
});
afterAll(async () => { await env?.cleanup(); });

const ctxFor = (role: Role) => {
  const u = DEMO_USERS.find((d) => d.role === role)!;
  return env.authenticatedContext(u.uid, { role, storeIds: u.storeIds, approvalLimitPaise: u.approvalLimitPaise, ...(u.vendorId ? { vendorId: u.vendorId } : {}) });
};

describe('registry stays in sync with rules', () => {
  it('every master key appears in firestore.rules', () => {
    const rules = readFileSync('../../firestore.rules', 'utf8');
    for (const k of MASTER_KEYS) if (!rules.includes(`'${k}'`)) throw new Error(`firestore.rules missing master ${k}`);
  });
});

describe('unauthenticated', () => {
  it('cannot read masters', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `${P}/skus/SKU-1`)));
  });
});

describe.each(ROLES.filter((r) => r !== 'vendor'))('staff role %s', (role) => {
  it('can read masters', async () => { await assertSucceeds(getDoc(doc(ctxFor(role).firestore(), `${P}/skus/SKU-1`))); });
  it('cannot write masters directly', async () => { await assertFails(setDoc(doc(ctxFor(role).firestore(), `${P}/skus/SKU-2`), { name: 'y' })); });
  it('cannot write stock / ledgers / audit logs', async () => {
    const db = ctxFor(role).firestore();
    await assertFails(setDoc(doc(db, `${P}/stock/WH_SKU-1`), { onHand: 999 }));
    await assertFails(setDoc(doc(db, `${P}/stockLedger/x`), { qty: 1 }));
    await assertFails(setDoc(doc(db, `${P}/auditLogs/l2`), { action: 'forged' }));
  });
});

describe('vendor', () => {
  it('cannot read masters or approvals', async () => {
    const db = ctxFor('vendor').firestore();
    await assertFails(getDoc(doc(db, `${P}/skus/SKU-1`)));
    await assertFails(getDoc(doc(db, `${P}/approvals/a1`)));
  });
});

describe('audit logs and approvals', () => {
  it.each(['super_admin', 'cfo', 'auditor'] as Role[])('%s can read audit logs', async (r) => {
    await assertSucceeds(getDoc(doc(ctxFor(r).firestore(), `${P}/auditLogs/l1`)));
  });
  it.each(['cashier', 'sales_associate', 'buyer', 'store_manager'] as Role[])('%s cannot read audit logs', async (r) => {
    await assertFails(getDoc(doc(ctxFor(r).firestore(), `${P}/auditLogs/l1`)));
  });
  it('cashier cannot read approvals unless maker', async () => {
    await assertFails(getDoc(doc(ctxFor('cashier').firestore(), `${P}/approvals/a1`)));
    await assertSucceeds(getDoc(doc(ctxFor('buyer').firestore(), `${P}/approvals/a1`)));
  });
});

describe('storage', () => {
  const png = new Uint8Array([1, 2, 3]);
  it('buyer may upload master images; cashier may not', async () => {
    await assertSucceeds(uploadBytes(ref(ctxFor('buyer').storage(), `orgs/texafashions/master/skus/a.png`), png, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(ctxFor('cashier').storage(), `orgs/texafashions/master/skus/b.png`), png, { contentType: 'image/png' }));
  });
  it('rejects non-images in master folder', async () => {
    await assertFails(uploadBytes(ref(ctxFor('buyer').storage(), `orgs/texafashions/master/skus/c.exe`), png, { contentType: 'application/octet-stream' }));
  });
});

describe('Phase 2 — procurement & inventory rules', () => {
  const WRITE_TARGETS = [...new Set(OPS_DOCS.map(([c]) => c))];
  describe.each(ROLES)('%s can never write operational collections directly', (role) => {
    it('denies writes to every Phase 2 collection', async () => {
      const db = ctxFor(role).firestore();
      for (const c of WRITE_TARGETS) await assertFails(setDoc(doc(db, `${P}/${c}/hack`), { x: 1 }));
    });
  });
  it('nobody can read number counters', async () => {
    for (const r of ROLES) await assertFails(getDoc(doc(ctxFor(r).firestore(), `${P}/counters/PO_WH_26-27`)));
  });

  describe('buyer', () => {
    it.each(['purchaseOrders/PO-IN', 'rfqs/R1', 'quotations/Q1', 'grns/G1', 'purchaseInvoices/I1', 'paymentVouchers/PV1', 'stock/BLR-FS_S1', 'stockLedger/L1', 'purchaseRequisitions/PR-HYD'])('reads %s', async (path) => {
      await assertSucceeds(getDoc(doc(ctxFor('buyer').firestore(), `${P}/${path}`)));
    });
  });
  describe('warehouse manager', () => {
    it.each(['grns/G1', 'qcInspections/QC1', 'putawayTasks/PT1', 'gateEntries/GE1', 'stock/WH-CENTRAL_S1', 'stockTransfers/T-BLR', 'ewayBills/EW1'])('reads %s', async (path) => {
      await assertSucceeds(getDoc(doc(ctxFor('warehouse_manager').firestore(), `${P}/${path}`)));
    });
  });
  describe('vendor', () => {
    const db = () => ctxFor('vendor').firestore();
    it('reads only its own PO, ASN and ack', async () => {
      await assertSucceeds(getDoc(doc(db(), `${P}/purchaseOrders/PO-KR`)));
      await assertSucceeds(getDoc(doc(db(), `${P}/asns/ASN-KR`)));
      await assertSucceeds(getDoc(doc(db(), `${P}/poAcks/ACK-KR`)));
      await assertFails(getDoc(doc(db(), `${P}/purchaseOrders/PO-IN`)));
    });
    it('can list its POs with a vendorId filter but not unfiltered', async () => {
      await assertSucceeds(getDocs(query(collection(db(), `${P}/purchaseOrders`), where('vendorId', '==', 'V-KR-001'))));
      await assertFails(getDocs(collection(db(), `${P}/purchaseOrders`)));
      await assertFails(getDocs(query(collection(db(), `${P}/purchaseOrders`), where('vendorId', '==', 'V-IN-001'))));
    });
    it.each(['stock/WH-CENTRAL_S1', 'grns/G1', 'purchaseInvoices/I1', 'paymentVouchers/PV1', 'apBills/AP1', 'quotations/Q1', 'rfqs/R1', 'landedCosts/LC1', 'stockTransfers/T-BLR'])('cannot read %s', async (path) => {
      await assertFails(getDoc(doc(db(), `${P}/${path}`)));
    });
  });
  describe('store scoping', () => {
    it('BLR store manager sees BLR stock/PR/transfers but not HYD', async () => {
      const db = ctxFor('store_manager').firestore();
      await assertSucceeds(getDoc(doc(db, `${P}/stock/BLR-FS_S1`)));
      await assertFails(getDoc(doc(db, `${P}/stock/HYD-NX_S1`)));
      await assertSucceeds(getDoc(doc(db, `${P}/purchaseRequisitions/PR-BLR`)));
      await assertFails(getDoc(doc(db, `${P}/purchaseRequisitions/PR-HYD`)));
      await assertSucceeds(getDoc(doc(db, `${P}/stockTransfers/T-BLR`)));
      await assertSucceeds(getDoc(doc(db, `${P}/adjustments/AD1`)));
    });
    it('store manager cannot read purchase orders, invoices or payments', async () => {
      const db = ctxFor('store_manager').firestore();
      for (const p of ['purchaseOrders/PO-IN', 'purchaseInvoices/I1', 'paymentVouchers/PV1', 'grns/G1']) await assertFails(getDoc(doc(db, `${P}/${p}`)));
    });
    it('cashier reads own-store stock only', async () => {
      const db = ctxFor('cashier').firestore();
      await assertSucceeds(getDoc(doc(db, `${P}/stock/PUN-PMC_S1`)));
      await assertFails(getDoc(doc(db, `${P}/stock/BLR-FS_S1`)));
      await assertFails(getDoc(doc(db, `${P}/purchaseRequisitions/PR-BLR`)));
    });
    it('auditor reads everything operational, writes nothing', async () => {
      const db = ctxFor('auditor').firestore();
      for (const p of ['purchaseOrders/PO-IN', 'grns/G1', 'paymentVouchers/PV1', 'stock/HYD-NX_S1', 'stockLedger/L1']) await assertSucceeds(getDoc(doc(db, `${P}/${p}`)));
    });
  });

  describe('storage — vendor folder', () => {
    const png = new Uint8Array([1, 2, 3]);
    it('vendor writes only to its own folder', async () => {
      const st = ctxFor('vendor').storage();
      await assertSucceeds(uploadBytes(ref(st, 'orgs/texafashions/vendor-portal/V-KR-001/proforma.pdf'), png, { contentType: 'application/pdf' }));
      await assertFails(uploadBytes(ref(st, 'orgs/texafashions/vendor-portal/V-IN-001/proforma.pdf'), png, { contentType: 'application/pdf' }));
      await assertFails(uploadBytes(ref(st, 'orgs/texafashions/scm/invoices/x.pdf'), png, { contentType: 'application/pdf' }));
    });
    it('warehouse uploads QC photos; cashier cannot; vendor cannot upload QC photos', async () => {
      await assertSucceeds(uploadBytes(ref(ctxFor('warehouse_manager').storage(), 'orgs/texafashions/scm/qc/g1/a.jpg'), png, { contentType: 'image/jpeg' }));
      await assertFails(uploadBytes(ref(ctxFor('cashier').storage(), 'orgs/texafashions/scm/qc/g1/b.jpg'), png, { contentType: 'image/jpeg' }));
      await assertFails(uploadBytes(ref(ctxFor('vendor').storage(), 'orgs/texafashions/scm/qc/g1/c.jpg'), png, { contentType: 'image/jpeg' }));
    });
    it('CFO uploads invoices for OCR', async () => {
      await assertSucceeds(uploadBytes(ref(ctxFor('cfo').storage(), 'orgs/texafashions/scm/invoices/i1.pdf'), png, { contentType: 'application/pdf' }));
    });
  });
});


describe('Phase 3 — POS rules', () => {
  const outbox = (over: Record<string, unknown> = {}) => ({
    status: 'pending', clientSaleId: 'sale-0001', storeId: 'PUN-PMC', tillId: 'PUN-PMC-T1', shiftId: 'SH-PUN', cashierId: 'demo-cashier', cashierName: 'Imran', provisionalNo: 'PRV/T1/261105/0001',
    createdAtClient: new Date().toISOString(), clientTotalPaise: 10000, input: { lines: [] }, createdBy: 'demo-cashier', ...over,
  });
  const cashier = () => ctxFor('cashier').firestore();
  it('cashier can create an offline outbox sale for own store (id == clientSaleId)', async () => {
    await assertSucceeds(setDoc(doc(cashier(), `${P}/posOutbox/sale-0001`), outbox()));
  });
  it('cashier cannot create outbox for another store, with another uid, wrong status, extra field or mismatched id', async () => {
    await assertFails(setDoc(doc(cashier(), `${P}/posOutbox/sale-0002`), outbox({ clientSaleId: 'sale-0002', storeId: 'BLR-FS' })));
    await assertFails(setDoc(doc(cashier(), `${P}/posOutbox/sale-0003`), outbox({ clientSaleId: 'sale-0003', createdBy: 'someone-else' })));
    await assertFails(setDoc(doc(cashier(), `${P}/posOutbox/sale-0004`), outbox({ clientSaleId: 'sale-0004', status: 'finalised' })));
    await assertFails(setDoc(doc(cashier(), `${P}/posOutbox/sale-0005`), outbox({ clientSaleId: 'sale-0005', invoiceNo: 'FAKE' })));
    await assertFails(setDoc(doc(cashier(), `${P}/posOutbox/other-id`), outbox({ clientSaleId: 'sale-0006' })));
  });
  it('outbox is create-only', async () => {
    await assertFails(setDoc(doc(cashier(), `${P}/posOutbox/OB-PUN`), outbox({ clientSaleId: 'OB-PUN' })));
    await assertFails(setDoc(doc(cashier(), `${P}/posOutbox/sale-0001`), outbox({ clientTotalPaise: 1 })));
  });
  it('vendor, buyer and auditor cannot create outbox sales', async () => {
    for (const r of ['vendor', 'buyer', 'auditor'] as Role[]) await assertFails(setDoc(doc(ctxFor(r).firestore(), `${P}/posOutbox/sale-9`), outbox({ clientSaleId: 'sale-9', createdBy: DEMO_USERS.find((d) => d.role === r)!.uid })));
  });
  it('cashier cannot write sales, shifts, tills, returns, z-reports, gift cards, vouchers, promotions, credit notes, journals', async () => {
    for (const c of ['sales', 'shifts', 'tills', 'returns', 'zReports', 'giftCards', 'vouchers', 'promotions', 'creditNotes', 'loyaltyLedger', 'journals', 'salesDailyShards', 'reservations'])
      await assertFails(setDoc(doc(cashier(), `${P}/${c}/x1`), { storeId: 'PUN-PMC', balancePaise: 999999 }));
    await assertFails(setDoc(doc(cashier(), `${P}/giftCards/GC-1`), { balancePaise: 999999 }, { merge: true }));
  });
  it('cashier reads own-store sales/shift/till but not other stores', async () => {
    for (const p of ['sales/S-PUN', 'shifts/SH-PUN', 'tills/PUN-PMC-T1', 'returns/R-PUN', 'zReports/Z-PUN', 'reservations/RV-PUN', 'creditNotes/CN-PUN']) await assertSucceeds(getDoc(doc(cashier(), `${P}/${p}`)));
    await assertFails(getDoc(doc(cashier(), `${P}/sales/S-BLR`)));
    await assertSucceeds(getDocs(query(collection(cashier(), `${P}/sales`), where('storeId', '==', 'PUN-PMC'))));
    await assertFails(getDocs(query(collection(cashier(), `${P}/sales`), where('storeId', '==', 'BLR-FS'))));
  });
  it('staff read promotions, vouchers, gift cards; vendor cannot', async () => {
    for (const p of ['promotions/P-1', 'vouchers/V-1', 'giftCards/GC-1', 'loyaltyLedger/LL-1']) { await assertSucceeds(getDoc(doc(cashier(), `${P}/${p}`))); await assertFails(getDoc(doc(ctxFor('vendor').firestore(), `${P}/${p}`))); }
  });
  it('posUsers, journals, shards and counters are server-only', async () => {
    for (const r of ROLES) for (const p of ['posUsers/PUN-PMC_CSH01', 'journals/J-1', 'salesDailyShards/D-1']) await assertFails(getDoc(doc(ctxFor(r).firestore(), `${P}/${p}`)));
  });
  it('parked bills: own-store staff CRUD drafts; other stores and extra fields denied', async () => {
    const draft = { storeId: 'PUN-PMC', tillId: 'PUN-PMC-T1', cashierId: 'demo-cashier', label: 'Bill 1', customer: null, lines: [], createdAt: 1, updatedAt: 1 };
    await assertSucceeds(setDoc(doc(cashier(), `${P}/parkedBills/pb1`), draft));
    await assertSucceeds(setDoc(doc(cashier(), `${P}/parkedBills/pb1`), { ...draft, label: 'Renamed' }));
    await assertSucceeds(getDoc(doc(cashier(), `${P}/parkedBills/pb1`)));
    await assertFails(setDoc(doc(cashier(), `${P}/parkedBills/pb2`), { ...draft, storeId: 'BLR-FS' }));
    await assertFails(setDoc(doc(cashier(), `${P}/parkedBills/pb3`), { ...draft, totalPaise: 1 }));
    await assertFails(setDoc(doc(ctxFor('vendor').firestore(), `${P}/parkedBills/pb4`), draft));
    await assertSucceeds(deleteDoc(doc(cashier(), `${P}/parkedBills/pb1`)));
  });
});

describe('Phase 4 — OMS + Shopify connector rules', () => {
  const OMS = ['webOrders', 'pickLists', 'shipments', 'rtoCases', 'codRemittances', 'shopifyEvents', 'failedEvents', 'stockPushRuns', 'shopifyStock', 'syncHealth'];
  const doc1: Record<string, string> = { webOrders: 'WO-1', pickLists: 'PL-WH', shipments: 'SHP-WH', rtoCases: 'RTO-WH', codRemittances: 'CR-1', shopifyEvents: 'EV-1', failedEvents: 'FE-1', stockPushRuns: 'SP-1', shopifyStock: 'S1', syncHealth: 'shopify' };
  it('no role can write any OMS collection from the client (webhooks/functions only)', async () => {
    for (const role of ROLES) for (const c of OMS) await assertFails(setDoc(doc(ctxFor(role).firestore(), `${P}/${c}/client-write`), { x: 1 }));
    for (const c of OMS) await assertFails(deleteDoc(doc(ctxFor('super_admin').firestore(), `${P}/${c}/${doc1[c]}`)));
  });
  it('HQ roles read web orders, events, failed events, remittances and push history', async () => {
    for (const role of ['super_admin', 'cfo', 'buyer', 'warehouse_manager', 'auditor'] as Role[])
      for (const c of ['webOrders', 'codRemittances', 'shopifyEvents', 'failedEvents', 'stockPushRuns', 'shopifyStock', 'syncHealth']) await assertSucceeds(getDoc(doc(ctxFor(role).firestore(), `${P}/${c}/${doc1[c]}`)));
  });
  it('store roles, cashiers, HR and vendors cannot read customer-PII collections', async () => {
    for (const role of ['store_manager', 'cashier', 'sales_associate', 'hr_manager', 'vendor'] as Role[])
      for (const c of ['webOrders', 'codRemittances', 'shopifyEvents', 'failedEvents', 'stockPushRuns', 'shopifyStock', 'syncHealth']) await assertFails(getDoc(doc(ctxFor(role).firestore(), `${P}/${c}/${doc1[c]}`)));
  });
  it('pick lists / shipments / RTO cases are location-scoped', async () => {
    const sm = ctxFor('store_manager').firestore();                               // BLR stores
    await assertSucceeds(getDoc(doc(sm, `${P}/pickLists/PL-BLR`)));
    await assertFails(getDoc(doc(sm, `${P}/pickLists/PL-HYD`)));
    await assertFails(getDoc(doc(sm, `${P}/pickLists/PL-WH`)));
    await assertSucceeds(getDocs(query(collection(sm, `${P}/pickLists`), where('locationId', '==', 'BLR-FS'))));
    await assertFails(getDocs(collection(sm, `${P}/pickLists`)));                 // unfiltered list is not provably in scope
    const wh = ctxFor('warehouse_manager').firestore();
    await assertSucceeds(getDoc(doc(wh, `${P}/pickLists/PL-WH`))); await assertSucceeds(getDoc(doc(wh, `${P}/shipments/SHP-WH`))); await assertSucceeds(getDoc(doc(wh, `${P}/rtoCases/RTO-WH`)));
    await assertFails(getDoc(doc(ctxFor('vendor').firestore(), `${P}/shipments/SHP-WH`)));
    await assertFails(getDoc(doc(ctxFor('cashier').firestore(), `${P}/shipments/SHP-WH`)));   // Pune cashier, warehouse parcel
  });
  it('unauthenticated users read nothing', async () => {
    const anon = env.unauthenticatedContext().firestore();
    for (const c of OMS) await assertFails(getDoc(doc(anon, `${P}/${c}/${doc1[c]}`)));
  });
});
