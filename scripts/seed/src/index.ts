/* Seeds the Firebase demo project (needs GOOGLE_APPLICATION_CREDENTIALS) with Texa Fashions master data. Idempotent: re-running overwrites. */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { DEMO_USERS, MASTER_MAP, ORG_ID, searchKeywordsFor } from '@texafashions/types';
import { makeGstin, GST_STATE_CODES } from '@texafashions/domain';
import { CATEGORIES, CHARACTERS, DEPARTMENTS, SUBS, generateSkus } from './catalogue';
import { rng } from './rng';
import { seedStock } from './stock';

process.env.GCLOUD_PROJECT ??= process.env.FIREBASE_PROJECT_ID ?? 'texafashions-demo';
if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db: Firestore = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const r = rng(42);

type Doc = Record<string, unknown> & { code: string };
const counts: Record<string, number> = {};

/** Writes docs as approved masters (version 1) in chunks of 150 docs (= 300 writes < 500). */
async function seed(master: string, docs: Doc[]) {
  const def = MASTER_MAP[master]!;
  for (let i = 0; i < docs.length; i += 150) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + 150)) {
      const ref = db.doc(`orgs/${ORG_ID}/${master}/${d.code}`);
      const clean = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
      batch.set(ref, { status: 'active', ...clean, version: 1, searchKeywords: searchKeywordsFor(def, clean), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: 'seed', createdBy: 'seed' });
      batch.set(ref.collection('versions').doc('00001'), { version: 1, data: clean, kind: 'create', changedBy: 'seed', changedAt: FieldValue.serverTimestamp(), approvedBy: 'seed' });
    }
    await batch.commit();
  }
  counts[master] = docs.length;
}
const nm = (code: string, name: string, extra: Record<string, unknown> = {}): Doc => ({ code, name, ...extra });

async function clearOperational() {
  // Phase 2 documents are rebuilt on every seed (collections can be large → delete in chunks).
  for (const c of ['stock', 'stockLedger', 'stockLocks', 'counters', 'replenishmentSuggestions', 'purchaseRequisitions', 'rfqs', 'quotations', 'purchaseOrders', 'poAcks', 'asns', 'billsOfEntry', 'gateEntries', 'grns', 'qcInspections', 'putawayTasks', 'purchaseInvoices', 'matchResults', 'paymentVouchers', 'debitNotes', 'purchaseReturns', 'landedCosts', 'stockTransfers', 'ewayBills', 'cycleCounts', 'stockTakes', 'adjustments', 'apBills', 'messageLog', 'sales', 'returns', 'shifts', 'zReports', 'posOutbox', 'parkedBills', 'reservations', 'creditNotes', 'loyaltyLedger', 'journals', 'salesDailyShards', 'vouchers', 'promotions', 'tills', 'posUsers', 'webOrders', 'pickLists', 'shipments', 'rtoCases', 'codRemittances', 'shopifyEvents', 'failedEvents', 'stockPushRuns', 'shopifyStock', 'syncHealth', 'budgets', 'reconFeeds', 'reconRuns', 'reconItems', 'candidates', 'onboardingTasks', 'attendance', 'leaveRequests', 'rosters', 'footfallHourly']) {
    for (;;) { const s = await db.collection(`orgs/${ORG_ID}/${c}`).limit(400).get(); if (s.empty) break; const b = db.batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit(); }
  }
  // purchase order versions subcollections are removed by recursiveDelete
  await db.recursiveDelete(db.collection(`orgs/${ORG_ID}/purchaseOrders`));
  await db.recursiveDelete(db.collection(`orgs/${ORG_ID}/giftCards`));
}

async function clearPrefix() {
  // Fresh seed: drop approvals/audit from earlier runs (masters are overwritten by id).
  for (const c of ['approvals', 'auditLogs']) { const s = await db.collection(`orgs/${ORG_ID}/${c}`).limit(400).get(); const b = db.batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit(); }
}

async function main() {
  console.log('Seeding Texa Fashions demo data…');
  await clearPrefix();
  await clearOperational();

  // ───────── Organisation & locations
  const STORES = [
    { code: 'PUN-PMC', name: 'Phoenix Market City Pune', city: 'Pune', state: 'Maharashtra', mall: 'Phoenix Market City', area: 1450, lat: 18.5619, lng: 73.9166 },
    { code: 'MUM-PMC', name: 'Phoenix Market City Mumbai', city: 'Mumbai', state: 'Maharashtra', mall: 'Phoenix Market City, Kurla', area: 1600, lat: 19.0867, lng: 72.8890 },
    { code: 'BLR-CS', name: 'Church Street Bengaluru', city: 'Bengaluru', state: 'Karnataka', mall: 'Church Street', area: 1100, lat: 12.9753, lng: 77.6063 },
    { code: 'BLR-M5', name: 'M5 Ecity Mall Bengaluru', city: 'Bengaluru', state: 'Karnataka', mall: 'M5 Ecity', area: 1250, lat: 12.8458, lng: 77.6602 },
    { code: 'BLR-FS', name: 'Forum South Bengaluru', city: 'Bengaluru', state: 'Karnataka', mall: 'Forum South', area: 1300, lat: 12.8905, lng: 77.5940 },
    { code: 'HYD-NX', name: 'Nexus Mall Hyderabad', city: 'Hyderabad', state: 'Telangana', mall: 'Nexus Mall', area: 1500, lat: 17.4933, lng: 78.3915 },
    { code: 'HYD-SC', name: 'Sarath City Mall Hyderabad', city: 'Hyderabad', state: 'Telangana', mall: 'Sarath City Capital Mall', area: 1700, lat: 17.4600, lng: 78.3640 },
    { code: 'NSK-CC', name: 'City Centre Mall Nashik', city: 'Nashik', state: 'Maharashtra', mall: 'City Centre Mall', area: 1000, lat: 19.9975, lng: 73.7898 },
  ];
  await seed('companies', [nm('TEXAFASHIONS-IN', 'Texa Fashions India', { legalName: 'Texa Fashions Lifestyle India Private Limited', pan: 'AABCU1234F', cin: 'U52100MH2022PTC000001', address: 'Mumbai, Maharashtra' })]);
  const gstins = (['Maharashtra', 'Karnataka', 'Telangana'] as const).map((st) => nm(`GST-${GST_STATE_CODES[st]}`, `GSTIN ${st}`, { gstin: makeGstin(GST_STATE_CODES[st]!, 'AABCU1234F'), state: st, companyId: 'TEXAFASHIONS-IN', isDefault: true }));
  await seed('gstins', gstins);
  const gstinFor = (st: string) => `GST-${GST_STATE_CODES[st]}`;
  const floorsFor = (c: string) => [{ id: 'F1', name: 'Ground', svg: '<svg viewBox="0 0 400 260"><rect x="4" y="4" width="392" height="252" rx="16" fill="#FFF6EF" stroke="#2B2633" stroke-width="3"/></svg>' }, ...(c === 'PUN-PMC' || c === 'MUM-PMC' || c === 'HYD-SC' ? [{ id: 'F2', name: 'First', svg: '<svg viewBox="0 0 400 260"><rect x="4" y="4" width="392" height="252" rx="16" fill="#F4EEFB" stroke="#2B2633" stroke-width="3"/></svg>' }] : [])];
  const zoneDefs = [['Entrance', [[10, 200], [120, 200], [120, 250], [10, 250]]], ['Plushies', [[10, 10], [140, 10], [140, 100], [10, 100]]], ['Bags', [[150, 10], [260, 10], [260, 100], [150, 100]]], ['K-Living', [[270, 10], [390, 10], [390, 100], [270, 100]]], ['Stationery', [[10, 110], [140, 110], [140, 190], [10, 190]]], ['Care', [[270, 110], [390, 110], [390, 190], [270, 190]]], ['Photobooth', [[150, 110], [260, 110], [260, 190], [150, 190]]], ['Cash Wrap', [[270, 200], [390, 200], [390, 250], [270, 250]]]] as const;
  const zonesFor = (c: string) => floorsFor(c).flatMap((f) => zoneDefs.map(([n, poly]) => ({ id: `${f.id}-${n.toUpperCase().replace(/\W/g, '')}`, floorId: f.id, name: n, polygon: poly.map(([x, y]) => ({ x, y })) })));
  await seed('costCentres', [...STORES.map((s) => nm(`CC-${s.code}`, `${s.name} cost centre`, { storeId: s.code })), nm('CC-HO', 'Head office'), nm('CC-WH', 'Central warehouse')]);
  await seed('stores', STORES.map((s) => nm(s.code, s.name, { city: s.city, state: s.state, mall: s.mall, gstinId: gstinFor(s.state), costCentreId: `CC-${s.code}`, areaSqFt: s.area, openingDate: '2024-06-01', lat: String(s.lat), lng: String(s.lng), format: 'Mall', geofenceMeters: 150, floors: floorsFor(s.code), zones: zonesFor(s.code) })));
  await seed('warehouses', [nm('WH-CENTRAL', 'Central Warehouse — Bhiwandi', { city: 'Bhiwandi', state: 'Maharashtra', gstinId: gstinFor('Maharashtra'), areaSqFt: 24000 })]);
  const bins: Doc[] = [];
  for (const [i, d] of DEPARTMENTS.entries()) for (let k = 1; k <= 4; k++) bins.push(nm(`BIN-${d.code}-${String(k).padStart(2, '0')}`, `${d.name} rack ${k}`, { warehouseId: 'WH-CENTRAL', aisle: `A${i + 1}`, rack: `R${k}`, capacityUnits: 2500, departmentId: d.code }));
  bins.push(nm('BIN-QC-01', 'QC hold area', { warehouseId: 'WH-CENTRAL', aisle: 'Q', rack: '1', capacityUnits: 1500 }), nm('BIN-DMG-01', 'Damaged goods cage', { warehouseId: 'WH-CENTRAL', aisle: 'D', rack: '1', capacityUnits: 200 }));
  await seed('bins', bins);

  // ───────── Catalogue
  await seed('departments', DEPARTMENTS.map((d) => nm(d.code, d.name, { colorHex: d.colorHex })));
  await seed('categories', CATEGORIES.map((c) => nm(c.code, c.name, { departmentId: c.departmentId })));
  await seed('subCategories', SUBS.map((s) => nm(s.code, s.name, { categoryId: `${s.dept}-${s.cat.replace(/[^A-Za-z]+/g, '').slice(0, 6).toUpperCase()}`, departmentId: s.dept, defaultGstRate: s.gst, defaultHsn: s.hsn })));
  await seed('brands', [nm('TEXAFASHIONS', 'Texa Fashions', { country: 'South Korea' }), nm('SEOULPICK', 'Texa Select', { country: 'South Korea' }), nm('MOMOCARE', 'Momo Care', { country: 'South Korea' })]);
  await seed('collections', [nm('COL-SS26', 'Spring Bloom 2026', { season: 'SS26', launchDate: '2026-02-01' }), nm('COL-FEST26', 'Festive Cuties 2026', { season: 'Festive', launchDate: '2026-09-15' }), nm('COL-BTS', 'Back to School', { season: 'Aug', launchDate: '2026-06-20' }), nm('COL-CAFE', 'Seoul Café', { season: 'Evergreen', launchDate: '2025-01-01' })]);
  await seed('styles', CHARACTERS.map((c) => nm(`STY-${c.toUpperCase()}`, `${c} character`, { character: c })));
  await seed('blindboxSeries', ['CITY', 'CAFE', 'GARDEN', 'SPACE'].map((s) => nm(`BB-${s}`, `${s[0]}${s.slice(1).toLowerCase()} series`, { figuresPerSet: 12, secretFigure: `Secret ${s.toLowerCase()} star`, pricePaise: 49900 })));
  const skus = generateSkus(STORES.map((s) => s.code), 300);
  // Deliberate near-duplicate pair for the AI duplicate-detection demo.
  const dupSrc = skus.find((s) => s.name.toLowerCase().includes('plush 20cm'))!;
  skus.push({ ...dupSrc, code: 'SKU-PL-SML-DUP1', name: dupSrc.name.replace('Plush 20cm', 'Plush 20 cm'), barcode: '8909999999990' });
  const svcGift = { code: 'SVC-GIFTWRAP', name: 'Gift wrapping service', departmentId: 'LIF', categoryId: 'LIF-ACCESS', brandId: 'TEXAFASHIONS', barcode: '8900000000017', hsn: '9985', gstRate: '18', mrpPaise: 4900, costPaise: 500, pricePaise: 4900, isService: true, status: 'active' };
  await seed('skus', [...skus, svcGift] as unknown as Doc[]);
  await seed('priceLists', [nm('PL-RETAIL', 'Retail MRP list', { channel: 'All', validFrom: '2026-01-01', items: Object.fromEntries(skus.slice(0, 40).map((s) => [s.code, s.pricePaise])) }), nm('PL-B2B', 'B2B gifting list (-15%)', { channel: 'B2B', validFrom: '2026-01-01', items: Object.fromEntries(skus.slice(0, 40).map((s) => [s.code, Math.round(s.pricePaise * 0.85)])) })]);

  // ───────── Partners
  const vendors: Doc[] = [];
  const kr = ['Asia Trading Co.', 'Eastern Craft Ltd', 'Harbour Gifts', 'Riverside Plush', 'Metro Stationery', 'Beauty Source', 'Coastal Home Goods', 'Uptown Accessories'];
  const cn = ['Yiwu Cute Factory', 'Shenzhen Toys Co', 'Guangzhou Bags Ltd', 'Ningbo Stationery', 'Dongguan Plush Works', 'Shantou Novelty'];
  const inn = ['Mumbai Packaging Co', 'Pune Print House', 'Bengaluru Gift Wrap', 'Hyderabad Pearl Crafts', 'Delhi Lifestyle Supplies', 'Nashik Textiles'];
  kr.forEach((n, i) => vendors.push(nm(`V-KR-${String(i + 1).padStart(3, '0')}`, n, { country: 'South Korea', currency: 'KRW', incoterm: 'FOB', paymentTermsDays: 45, isMsme: false, onTimePct: r.int(78, 98), fillRatePct: r.int(85, 99), defectPct: r.int(1, 6), email: `sales@${n.split(' ')[0]!.toLowerCase()}.kr`, contactName: 'Kim Min-jun', tdsRatePct: 0 })));
  cn.forEach((n, i) => vendors.push(nm(`V-CN-${String(i + 1).padStart(3, '0')}`, n, { country: 'China', currency: i % 2 ? 'USD' : 'CNY', incoterm: 'CIF', paymentTermsDays: 30, isMsme: false, onTimePct: r.int(70, 95), fillRatePct: r.int(80, 98), defectPct: r.int(2, 9), email: `export@${n.split(' ')[0]!.toLowerCase()}.cn`, tdsRatePct: 0 })));
  inn.forEach((n, i) => vendors.push(nm(`V-IN-${String(i + 1).padStart(3, '0')}`, n, { country: 'India', currency: 'INR', incoterm: 'DDP', paymentTermsDays: 30, isMsme: i % 2 === 0, onTimePct: r.int(85, 99), fillRatePct: r.int(90, 100), defectPct: r.int(0, 3), gstin: makeGstin(GST_STATE_CODES[['Maharashtra', 'Karnataka', 'Telangana'][i % 3]!]!, `AAC${'PQRSTU'[i]}A${1000 + i}K`), tdsRatePct: 2, email: `orders@${n.split(' ')[0]!.toLowerCase()}.in` })));
  await seed('vendors', vendors);
  await seed('vendorPriceLists', [nm('VPL-KR-001', 'Hana Trading — 2026 list', { vendorId: 'V-KR-001', currency: 'KRW', validFrom: '2026-01-01', items: Object.fromEntries(skus.slice(0, 20).map((s) => [s.code, Math.round(s.costPaise / 100 * 16)])) }), nm('VPL-CN-001', 'Yiwu Cute — 2026 list', { vendorId: 'V-CN-001', currency: 'CNY', validFrom: '2026-01-01', items: Object.fromEntries(skus.slice(20, 40).map((s) => [s.code, Math.round(s.costPaise / 100 / 11)])) })]);
  await seed('customerTiers', [nm('CUTIE', 'Cutie', { minSpendPaise: 0, earnRatePct: 5, birthdayBonusPoints: 50 }), nm('BESTIE', 'Bestie', { minSpendPaise: 1500000, earnRatePct: 7, birthdayBonusPoints: 150 }), nm('SEOULMATE', 'Soulmate', { minSpendPaise: 4000000, earnRatePct: 10, birthdayBonusPoints: 400 })]);
  const first = ['Aarav', 'Ananya', 'Diya', 'Ishaan', 'Kavya', 'Meera', 'Nikhil', 'Priya', 'Rohan', 'Saanvi', 'Tanvi', 'Vihaan', 'Zoya', 'Arjun', 'Neha', 'Siddharth', 'Riya', 'Karan', 'Aditi', 'Rahul'];
  const last = ['Sharma', 'Patil', 'Reddy', 'Iyer', 'Nair', 'Gupta', 'Kulkarni', 'Rao', 'Shah', 'Mehta', 'Joshi', 'Desai', 'Khan', 'Naidu', 'Bhat'];
  const cities = ['Pune', 'Mumbai', 'Bengaluru', 'Hyderabad', 'Nashik'];
  await seed('customers', Array.from({ length: 2000 }, (_, i) => { const t = i < 1500 ? 'CUTIE' : i < 1900 ? 'BESTIE' : 'SEOULMATE'; return nm(`C-${String(i + 1).padStart(5, '0')}`, `${r.pick(first)} ${r.pick(last)}`, { mobile: `9${r.int(100000000, 999999999)}`, tierId: t, pointsBalance: r.int(0, t === 'SEOULMATE' ? 4000 : 900), favouriteCharacter: r.pick(CHARACTERS), city: r.pick(cities), whatsappOptIn: r.chance(0.8), birthday: `199${r.int(0, 9)}-${String(r.int(1, 12)).padStart(2, '0')}-${String(r.int(1, 28)).padStart(2, '0')}` }); }));
  await seed('transporters', [nm('TR-DELHIVERY', 'Delhivery Freight', { mode: 'Road' }), nm('TR-BLUEDART', 'Blue Dart', { mode: 'Air' }), nm('TR-VRL', 'VRL Logistics', { mode: 'Road' })]);
  await seed('chas', [nm('CHA-NHAVA', 'Nhava Sheva Customs Brokers', { port: 'JNPT Nhava Sheva', licence: 'CHA/MUM/2041' }), nm('CHA-CHENNAI', 'Chennai Port Clearing Agents', { port: 'Chennai', licence: 'CHA/CHE/1187' })]);

  // ───────── Finance
  const L = (c: string, n: string, type: string, grp: string, tally = n) => nm(c, n, { type, parentGroup: grp, tallyName: tally });
  const ledgers = [
    L('L-CASH', 'Cash in hand', 'Asset', 'Cash-in-Hand'), L('L-BANK-HDFC', 'HDFC Current A/c', 'Asset', 'Bank Accounts'), L('L-UPI-CLR', 'UPI clearing', 'Asset', 'Current Assets'), L('L-CARD-CLR', 'Card settlement clearing', 'Asset', 'Current Assets'),
    L('L-COD-CLR', 'COD receivable (couriers)', 'Asset', 'Sundry Debtors'), L('L-GW-CLR', 'Shopify payments clearing', 'Asset', 'Current Assets'), L('L-INV', 'Inventory — stock in trade', 'Asset', 'Stock-in-Hand'), L('L-GIT', 'Goods in transit', 'Asset', 'Current Assets'),
    L('L-IGST-IN', 'IGST input credit', 'Asset', 'Duties & Taxes'), L('L-CGST-IN', 'CGST input credit', 'Asset', 'Duties & Taxes'), L('L-SGST-IN', 'SGST input credit', 'Asset', 'Duties & Taxes'),
    L('L-AP', 'Sundry creditors', 'Liability', 'Sundry Creditors'), L('L-GRIR-CLR', 'GR/IR clearing', 'Liability', 'Current Liabilities'), L('L-CGST-OUT', 'CGST output', 'Liability', 'Duties & Taxes'), L('L-SGST-OUT', 'SGST output', 'Liability', 'Duties & Taxes'), L('L-IGST-OUT', 'IGST output', 'Liability', 'Duties & Taxes'),
    L('L-TDS', 'TDS payable', 'Liability', 'Duties & Taxes'), L('L-GC-LIAB', 'Gift card liability', 'Liability', 'Current Liabilities'), L('L-LOY-LIAB', 'Loyalty points liability', 'Liability', 'Current Liabilities'), L('L-PF-PAY', 'PF payable', 'Liability', 'Duties & Taxes'), L('L-ESI-PAY', 'ESI payable', 'Liability', 'Duties & Taxes'), L('L-PT-PAY', 'Professional tax payable', 'Liability', 'Duties & Taxes'), L('L-SAL-PAY', 'Salary payable', 'Liability', 'Current Liabilities'),
    L('L-SALES', 'Sales — retail', 'Income', 'Sales Accounts'), L('L-SALES-WEB', 'Sales — web', 'Income', 'Sales Accounts'), L('L-SALES-RET', 'Sales returns', 'Income', 'Sales Accounts'), L('L-DISC', 'Discounts allowed', 'Expense', 'Direct Expenses'),
    L('L-COGS', 'Cost of goods sold', 'Expense', 'Direct Expenses'), L('L-PURCH', 'Purchases', 'Expense', 'Purchase Accounts'), L('L-CUSTOMS', 'Customs duty', 'Expense', 'Direct Expenses'), L('L-FREIGHT', 'Freight inward', 'Expense', 'Direct Expenses'),
    L('L-RENT', 'Rent', 'Expense', 'Indirect Expenses'), L('L-SAL', 'Salaries & wages', 'Expense', 'Indirect Expenses'), L('L-DEPR', 'Depreciation', 'Expense', 'Indirect Expenses'), L('L-BANKCHG', 'Bank & gateway charges', 'Expense', 'Indirect Expenses'), L('L-SHRINK', 'Stock shrinkage', 'Expense', 'Indirect Expenses'), L('L-FREIGHT-OUT', 'Freight outward & COD fees', 'Expense', 'Indirect Expenses'), L('L-SUSPENSE', 'Suspense — unreconciled receipts', 'Liability', 'Current Liabilities'),
    L('L-CN-LIAB', 'Credit note liability', 'Liability', 'Current Liabilities'), L('L-ROUNDOFF', 'Round-off', 'Expense', 'Indirect Expenses'), L('L-FA', 'Fixed assets', 'Asset', 'Fixed Assets'), L('L-CAP', 'Share capital', 'Equity', 'Capital Account'),
  ];
  await seed('ledgers', ledgers);
  await seed('taxCodes', [...['0', '5', '12', '18', '28'].map((p) => nm(`GST${p}`, `GST ${p}%`, { kind: 'GST', ratePct: Number(p) })), nm('TDS-194C', 'TDS 194C (contractors)', { kind: 'TDS', ratePct: 2, ledgerId: 'L-TDS' }), nm('TDS-194Q', 'TDS 194Q (purchase of goods)', { kind: 'TDS', ratePct: 0.1, ledgerId: 'L-TDS' }), nm('BCD', 'Basic customs duty', { kind: 'Customs', ratePct: 10, ledgerId: 'L-CUSTOMS' }), nm('SWS', 'Social welfare surcharge', { kind: 'Customs', ratePct: 10 })]);
  await seed('paymentModes', [nm('CASH', 'Cash', { kind: 'Cash', ledgerId: 'L-CASH' }), nm('UPI', 'UPI', { kind: 'UPI', ledgerId: 'L-UPI-CLR', feePct: 0 }), nm('CARD', 'Credit / debit card', { kind: 'Card', ledgerId: 'L-CARD-CLR', feePct: 1.8 }), nm('GC', 'Gift card', { kind: 'Gift card', ledgerId: 'L-GC-LIAB' }), nm('CN', 'Credit note', { kind: 'Store credit' }), nm('COD', 'Cash on delivery', { kind: 'COD', ledgerId: 'L-COD-CLR' }), nm('SHOPIFY', 'Shopify Payments', { kind: 'Wallet', ledgerId: 'L-GW-CLR', feePct: 2 })]);
  await seed('bankAccounts', [nm('BA-HDFC', 'HDFC Current — 5020', { bank: 'HDFC Bank', accountNo: 'XXXXXX5020', ifsc: 'HDFC0000240', ledgerId: 'L-BANK-HDFC' }), nm('BA-ICICI', 'ICICI Current — 8812', { bank: 'ICICI Bank', accountNo: 'XXXXXX8812', ifsc: 'ICIC0000104' })]);
  await seed('fxRates', [nm('FX-KRW', 'Korean won', { currency: 'KRW', ratePaisePerUnit: 6.1, asOf: '2026-11-01' }), nm('FX-CNY', 'Chinese yuan', { currency: 'CNY', ratePaisePerUnit: 1170, asOf: '2026-11-01' }), nm('FX-USD', 'US dollar', { currency: 'USD', ratePaisePerUnit: 8450, asOf: '2026-11-01' })]);

  // ───────── Promotions
  await seed('promotionTypes', [['tender', 'Tender-based (UPI/card)'], ['cart_threshold', 'Cart threshold'], ['bxgy', 'Buy X Get Y'], ['bundle', 'Bundle price'], ['markdown', 'Category / SKU markdown'], ['tiered', 'Tiered spend'], ['loyalty_tier', 'Loyalty-tier'], ['happy_hour', 'Happy hour'], ['free_gift', 'Free gift']].map(([k, n], i) => nm(k!.toUpperCase(), n!, { engineKind: k, stackable: i > 4, priority: (i + 1) * 10 })));
  await seed('voucherSeries', [nm('VS-WELCOME', 'Welcome ₹100', { prefix: 'WEL', valuePaise: 10000, minSpendPaise: 59900, usage: 'single', perCustomerLimit: 1, validFrom: '2026-01-01', validTo: '2026-12-31', channel: 'All' }), nm('VS-BDAY', 'Birthday 10%', { prefix: 'BDY', percentOff: 10, usage: 'single', perCustomerLimit: 1, channel: 'Store' })]);
  await seed('giftCardSeries', [nm('GCS-PHYS', 'Physical gift card', { kind: 'Physical', denominationPaise: 100000, validityMonths: 12 }), nm('GCS-EGIFT', 'E-gift card', { kind: 'E-gift', denominationPaise: 50000, validityMonths: 12 })]);
  await seed('loyaltyRules', [nm('LR-EARN', 'Earn 1 point per ₹100', { kind: 'earn', points: 1, perSpendPaise: 10000 }), nm('LR-BURN', '1 point = ₹1', { kind: 'burn', points: 1, perSpendPaise: 100 }), nm('LR-EXP', 'Points expire in 12 months', { kind: 'expiry', expiryMonths: 12 }), nm('LR-BDAY', 'Birthday bonus', { kind: 'birthday', points: 100 })]);

  // ───────── HR
  await seed('hrDepartments', [nm('HRD-RET', 'Retail operations'), nm('HRD-WH', 'Warehouse'), nm('HRD-HO', 'Head office'), nm('HRD-MER', 'Merchandising')]);
  const desigs = [['DS-SM', 'Store Manager', 5], ['DS-ASM', 'Assistant Store Manager', 4], ['DS-SA', 'Sales Associate', 2], ['DS-CSH', 'Cashier', 2], ['DS-VM', 'Visual Merchandiser', 3], ['DS-WH', 'Warehouse Executive', 2], ['DS-HR', 'HR Executive', 3], ['DS-ACC', 'Accountant', 3]] as const;
  await seed('designations', desigs.map(([c, n, l]) => nm(c, n, { level: l })));
  await seed('hrShifts', [nm('SH-MORN', 'Morning', { start: '10:00', end: '18:30', breakMinutes: 60 }), nm('SH-EVE', 'Evening', { start: '13:00', end: '22:00', breakMinutes: 60 }), nm('SH-WH', 'Warehouse day', { start: '09:00', end: '18:00', breakMinutes: 60 })]);
  await seed('holidays', [['2026-01-26', 'Republic Day', 'All'], ['2026-03-04', 'Holi', 'All'], ['2026-08-15', 'Independence Day', 'All'], ['2026-09-14', 'Ganesh Chaturthi', 'Maharashtra'], ['2026-10-02', 'Gandhi Jayanti', 'All'], ['2026-11-08', 'Diwali', 'All'], ['2026-11-01', 'Karnataka Rajyotsava', 'Karnataka'], ['2026-06-02', 'Telangana Formation Day', 'Telangana']].map(([d, n, s]) => nm(`HOL-${d}`, n!, { date: d, state: s })));
  await seed('leaveTypes', [nm('LT-CL', 'Casual leave', { annualQuota: 12, carryForward: false, paid: true }), nm('LT-SL', 'Sick leave', { annualQuota: 8, carryForward: false, paid: true }), nm('LT-PL', 'Privilege leave', { annualQuota: 15, carryForward: true, paid: true }), nm('LT-LOP', 'Loss of pay', { annualQuota: 0, carryForward: false, paid: false })]);
  await seed('salaryStructures', [nm('SS-SM', 'Store manager', { basicPaise: 2200000, hraPaise: 880000, specialAllowancePaise: 600000, commissionPct: 0.5, pfApplicable: true, esiApplicable: false }), nm('SS-SA', 'Sales associate', { basicPaise: 1000000, hraPaise: 400000, specialAllowancePaise: 150000, commissionPct: 1, pfApplicable: true, esiApplicable: true }), nm('SS-WH', 'Warehouse executive', { basicPaise: 1100000, hraPaise: 440000, specialAllowancePaise: 100000, commissionPct: 0, pfApplicable: true, esiApplicable: true })]);
  await seed('statutorySettings', [
    nm('STAT-MH', 'Maharashtra statutory', { state: 'Maharashtra', pfEmployeePct: 12, pfEmployerPct: 12, esiEmployeePct: 0.75, esiEmployerPct: 3.25, ptSlabs: [{ upTo: 750000, tax: 0 }, { upTo: 1000000, tax: 17500 }, { upTo: null, tax: 20000 }], lwfEmployeePaise: 2500 }),
    nm('STAT-KA', 'Karnataka statutory', { state: 'Karnataka', pfEmployeePct: 12, pfEmployerPct: 12, esiEmployeePct: 0.75, esiEmployerPct: 3.25, ptSlabs: [{ upTo: 2500000, tax: 0 }, { upTo: null, tax: 20000 }], lwfEmployeePaise: 2000 }),
    nm('STAT-TS', 'Telangana statutory', { state: 'Telangana', pfEmployeePct: 12, pfEmployerPct: 12, esiEmployeePct: 0.75, esiEmployerPct: 3.25, ptSlabs: [{ upTo: 1500000, tax: 0 }, { upTo: 2000000, tax: 15000 }, { upTo: null, tax: 20000 }], lwfEmployeePaise: 0 }),
  ]);
  const staffNames = Array.from({ length: 60 }, () => `${r.pick(first)} ${r.pick(last)}`);
  const emps: Doc[] = staffNames.map((n, i) => {
    const store = i < 56 ? STORES[i % 8]! : null;
    const role = i < 8 ? 'DS-SM' : i < 16 ? 'DS-ASM' : i < 40 ? 'DS-SA' : i < 52 ? 'DS-CSH' : i < 56 ? 'DS-VM' : i < 58 ? 'DS-WH' : i === 58 ? 'DS-HR' : 'DS-ACC';
    return nm(`E-${String(i + 1).padStart(4, '0')}`, n, { storeId: store?.code ?? (i < 58 ? 'WH-CENTRAL' : undefined), hrDepartmentId: store ? 'HRD-RET' : i < 58 ? 'HRD-WH' : 'HRD-HO', designationId: role, shiftId: role === 'DS-WH' ? 'SH-WH' : i % 2 ? 'SH-EVE' : 'SH-MORN', salaryStructureId: role === 'DS-SM' ? 'SS-SM' : role === 'DS-WH' ? 'SS-WH' : 'SS-SA', mobile: `9${r.int(100000000, 999999999)}`, doj: `202${r.int(3, 6)}-0${r.int(1, 9)}-1${r.int(0, 9)}`, state: store?.state ?? 'Maharashtra' });
  });
  await seed('employees', emps);

  // ───────── System
  await seed('reasonCodes', [['RC-ADJ-DMG', 'Damaged in store', 'stock_adjustment', false], ['RC-ADJ-THEFT', 'Theft / shrinkage', 'stock_adjustment', true], ['RC-ADJ-FOUND', 'Found stock', 'stock_adjustment', true], ['RC-RET-DEF', 'Defective product', 'pos_return', false], ['RC-RET-CHG', 'Changed mind', 'pos_return', true], ['RC-RET-WRG', 'Wrong item / size', 'pos_return', false], ['RC-VOID-ERR', 'Cashier error', 'pos_void', true], ['RC-QC-DMG', 'Transit damage', 'qc_reject', false], ['RC-QC-SPEC', 'Not to spec', 'qc_reject', false], ['RC-RTO-REF', 'Customer refused', 'rto', false], ['RC-DISC-MGR', 'Manager discretion', 'discount_override', true]].map(([c, n, ctx, ap]) => nm(c as string, n as string, { context: ctx, needsApproval: ap })));
  await seed('approvalMatrix', [['AM-PR-1', 'PR up to ₹50k', 'PR', 0, 5000000, 'buyer'], ['AM-PR-2', 'PR ₹50k–5L', 'PR', 5000001, 50000000, 'cfo'], ['AM-PR-3', 'PR above ₹5L', 'PR', 50000001, 99999999999, 'super_admin'], ['AM-PO-1', 'PO up to ₹5L', 'PO', 0, 50000000, 'buyer'], ['AM-PO-2', 'PO ₹5L–50L', 'PO', 50000001, 500000000, 'cfo'], ['AM-PO-3', 'PO above ₹50L', 'PO', 500000001, 99999999999, 'super_admin'], ['AM-PAY-1', 'Payment up to ₹2L', 'PAYMENT', 0, 20000000, 'cfo'], ['AM-PAY-2', 'Payment above ₹2L', 'PAYMENT', 20000001, 99999999999, 'super_admin'], ['AM-ADJ-1', 'Adjustment up to ₹10k', 'ADJUSTMENT', 0, 1000000, 'warehouse_manager'], ['AM-ADJ-2', 'Adjustment above ₹10k', 'ADJUSTMENT', 1000001, 99999999999, 'cfo']].map(([c, n, d, lo, hi, role]) => nm(c as string, n as string, { docType: d, minPaise: lo, maxPaise: hi, approverRole: role })));
  await seed('numberSeries', ['PR', 'PO', 'GRN', 'INV', 'TRF', 'PAY', 'JV'].map((d) => nm(`NS-${d}`, `${d} series`, { docType: d, format: '{DOC}/{STORE}/{FY}/{SEQ:5}', padding: 5 })));
  await seed('roles', DEMO_USERS.map((u) => nm(u.role, u.role.replace('_', ' '), { permissions: { note: 'Enforced in firestore.rules and functions' } })));
  await seed('notificationTemplates', [nm('NT-STOCKOUT', 'Stock-out risk', { channel: 'in_app', subject: 'Stock-out risk: {{sku}}', body: '{{sku}} at {{store}} will run out in {{days}} days.' }), nm('NT-PO-OVERDUE', 'PO overdue', { channel: 'email', subject: 'PO {{po}} overdue', body: 'Delivery was due {{date}}.' }), nm('NT-EBILL', 'E-bill', { channel: 'whatsapp', subject: 'Your Texa Fashions bill', body: 'Thanks {{name}}! Bill {{bill}}: {{link}}' }), nm('NT-BDAY', 'Birthday', { channel: 'whatsapp', subject: 'Happy birthday', body: 'Happy birthday {{name}} 🎂 here are 100 bonus Uni Points!' })]);

  // ───────── Demo auth users + a pending approval so the queue isn't empty
  const auth = getAuth();
  for (const u of DEMO_USERS) {
    const claims = { role: u.role, storeIds: u.storeIds, approvalLimitPaise: u.approvalLimitPaise, ...(u.vendorId ? { vendorId: u.vendorId } : {}) };
    try { await auth.getUser(u.uid); } catch { await auth.createUser({ uid: u.uid, email: u.email, displayName: u.displayName, password: 'demo-demo-1' }); }
    await auth.setCustomUserClaims(u.uid, claims);
  }
  const target = skus[3]!;
  await db.collection(`orgs/${ORG_ID}/approvals`).add({
    type: 'master', master: 'skus', kind: 'update', docId: target.code, note: 'Festive price revision',
    before: JSON.parse(JSON.stringify(target)), after: { ...JSON.parse(JSON.stringify(target)), pricePaise: target.pricePaise + 5000 }, status: 'pending',
    requestedBy: 'demo-buyer', requestedByName: 'Kavya Reddy', requestedAt: FieldValue.serverTimestamp(),
  });
  await db.doc(`orgs/${ORG_ID}/settings/org`).set({ name: 'Texa Fashions India', orgId: ORG_ID, currency: 'INR', timezone: 'Asia/Kolkata', seededAt: FieldValue.serverTimestamp() });

  await db.doc(`orgs/${ORG_ID}/settings/matching`).set({ priceBps: 200, qtyUnits: 0, totalBps: 100 });
  const stockWrites = await seedStock(db, skus, STORES.map((x) => x.code));
  console.log(`  · stock: ${stockWrites} docs (summary + opening ledger layers)`);
  const { seedScenarios } = await import('./scenarios');
  console.log('Seeding SCM scenarios through the real command handlers…');
  await seedScenarios(skus);
  console.log('Seeding POS: tills, staff, promotions, vouchers, gift cards, history…');
  const { seedPos } = await import('./pos');
  await seedPos(db, skus, STORES, staffNames);
  console.log('Seeding OMS: web orders at every stage, via the real handlers…');
  const { seedOms } = await import('./oms');
  await seedOms(db);
  console.log('Seeding Finance: budgets + backfilling journals for GRNs/invoices/payments/transfers…');
  const { seedFinance } = await import('./finance');
  await seedFinance(db, STORES.map((s) => s.code));
  const { seedRecon } = await import('./recon');
  await seedRecon(db);
  console.log('Seeding HR: recruitment kanban, onboarding, 30 days of attendance, leave, footfall + AI roster…');
  const { seedHr } = await import('./hr');
  const hrCounts = await seedHr(db, STORES.map((s) => ({ code: s.code, lat: s.lat, lng: s.lng })), emps as unknown as { code: string; name: string; storeId?: string }[]);
  console.log(`  · hr: ${JSON.stringify(hrCounts)}`);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.table(counts);
  console.log(`✓ Seeded ${Object.keys(counts).length} masters, ${total} documents, ${DEMO_USERS.length} demo users.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
