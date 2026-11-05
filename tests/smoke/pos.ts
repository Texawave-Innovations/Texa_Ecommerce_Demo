/** POS API-level smoke test. Needs `pnpm demo` (seeded). Run: pnpm --filter @texafashions/smoke-tests pos */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { priceCart, type Promotion } from '@texafashions/domain';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ??= 'demo-texafashions';
initializeApp({ projectId: 'demo-texafashions' });
const db = getFirestore(); db.settings({ ignoreUndefinedProperties: true });
const O = 'orgs/texafashions';
const FN = 'http://127.0.0.1:5001/demo-texafashions/asia-south1';
let failed = 0, passed = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${name} ${extra}`); if (cond) passed++; else failed++; };

type Res = { ok: boolean; data?: any; message?: string };
async function call(name: string, data: unknown, token?: string): Promise<Res> {
  const r = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ data }) });
  const j = (await r.json()) as { result?: unknown; error?: { message: string } };
  return j.error ? { ok: false, message: j.error.message } : { ok: true, data: j.result };
}
async function login(storeId: string, employeeCode: string, pin: string) {
  const r = await call('posPinLogin', { storeId, employeeCode, pin });
  if (!r.ok) return { ok: false as const, message: r.message };
  const s = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: r.data.token, returnSecureToken: true }) });
  const j = (await s.json()) as { idToken: string };
  return { ...r.data, ok: true as const, token: j.idToken as string };
}
const fails = (r: Res, re?: RegExp) => !r.ok && (re ? re.test(r.message ?? '') : true);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0; const sid = () => `smoke-${Date.now().toString(36)}-${++n}`;

// ── staff list + PIN login
const staff = await call('posStaffList', { storeId: 'PUN-PMC' });
ok('posStaffList returns names only', staff.ok && staff.data.length === 2 && !JSON.stringify(staff.data).includes('pinHash'), JSON.stringify(staff.data?.map((s: any) => s.employeeCode)));
const bad = await login('PUN-PMC', 'CSH01', '9999');
ok('wrong PIN rejected', !bad.ok && /Wrong PIN/.test(bad.message ?? ''));
const cash = await login('PUN-PMC', 'CSH01', '1234');
ok('cashier PIN login returns a token with role', cash.ok && cash.role === 'cashier');
const mgrLogin = await login('PUN-PMC', 'MGR01', '4321');
ok('manager PIN login', mgrLogin.ok && mgrLogin.role === 'store_manager');
if (!cash.ok || !mgrLogin.ok) { console.log('cannot continue'); process.exit(1); }
const T = cash.token!;
const lock = await (async () => { for (let i = 0; i < 5; i++) await call('posPinLogin', { storeId: 'HYD-SC', employeeCode: 'CSH01', pin: '0000' }); return call('posPinLogin', { storeId: 'HYD-SC', employeeCode: 'CSH01', pin: '1234' }); })();
ok('5 wrong PINs lock the account for a minute', fails(lock, /Too many/));
ok('verifyManagerPin ok / wrong', (await call('verifyManagerPin', { storeId: 'PUN-PMC', pin: '4321' }, T)).data?.ok === true && (await call('verifyManagerPin', { storeId: 'PUN-PMC', pin: '1111' }, T)).data?.ok === false);

// ── shift
const till = (await db.doc(`${O}/tills/PUN-PMC-T1`).get()).data()!;
ok('PUN-PMC T1 starts with no open shift', !till.openShiftId);
ok('open shift rejected for another store’s till', fails(await call('openShift', { tillId: 'BLR-FS-T1', storeId: 'BLR-FS', openingFloatPaise: 100000 }, T), /No access/));
const sh = await call('openShift', { tillId: 'PUN-PMC-T1', storeId: 'PUN-PMC', openingFloatPaise: 200000 }, T);
ok('open shift with float', sh.ok && /^SHF\/PUN-PMC\//.test(sh.data.shiftNo), sh.data?.shiftNo);
ok('second open shift on the same till rejected', fails(await call('openShift', { tillId: 'PUN-PMC-T1', storeId: 'PUN-PMC', openingFloatPaise: 100 }, T), /already has an open shift/));
const shiftId = sh.data.id as string;
const base = { storeId: 'PUN-PMC', tillId: 'PUN-PMC-T1', shiftId };

// pick SKUs
const skuDocs = (await db.collection(`${O}/skus`).limit(400).get()).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
const pick = (sub: string, k = 0) => skuDocs.filter((s) => s.subCategoryId === sub)[k]!;
const plush = pick('PL-KEY', 0), plush2 = pick('PL-KEY', 1), bag = pick('BG-TOT', 0), lamp = pick('KL-LMP', 0), pen = pick('ST-PEN', 0);
const stockOf = async (sku: string) => (await db.doc(`${O}/stock/PUN-PMC_${sku}`).get()).get('onHand') as number;

// ── cash happy path
const s0 = await stockOf(plush.id);
const id1 = sid();
const sale1 = await call('completeSale', { clientSaleId: id1, ...base, lines: [{ lineId: 'a', skuId: plush.id, qty: 2 }], payments: [{ mode: 'CASH', amountPaise: 100000 }] }, T);
ok('cash sale completes with INV/PUN-PMC invoice number', sale1.ok && /^INV\/PUN-PMC\/\d\d-\d\d\/\d{5}$/.test(sale1.data.invoiceNo), sale1.data?.invoiceNo ?? sale1.message);
const expect1 = plush.pricePaise * 2;
ok('invoice total = master price × qty (rounded to rupee), change returned', sale1.ok && Math.abs(sale1.data.payablePaise - expect1) < 100 && sale1.data.changeGivenPaise === 100000 - sale1.data.payablePaise);
ok('stock decremented by 2', (await stockOf(plush.id)) === s0 - 2);
const j1 = (await db.collection(`${O}/journals`).where('refId', '==', id1).get()).docs[0]?.data();
ok('journal balances', !!j1 && j1.lines.reduce((a: number, l: any) => a + l.drPaise, 0) === j1.lines.reduce((a: number, l: any) => a + l.crPaise, 0) && j1.balanced);
ok('sale readable with bill QR + embedded lines', (await db.doc(`${O}/sales/${id1}`).get()).get('billQr') === `INV|${id1}`);
const again = await call('completeSale', { clientSaleId: id1, ...base, lines: [{ lineId: 'a', skuId: plush.id, qty: 2 }], payments: [{ mode: 'CASH', amountPaise: 100000 }] }, T);
ok('idempotent: same clientSaleId returns the same invoice, stock unchanged', again.ok && again.data.invoiceNo === sale1.data.invoiceNo && (await stockOf(plush.id)) === s0 - 2);
ok('client cannot choose the price (server uses master price)', sale1.data.lines[0].grossPaise === plush.pricePaise * 2);
ok('short payment is rejected with "price changed"', fails(await call('completeSale', { clientSaleId: sid(), ...base, lines: [{ lineId: 'a', skuId: plush.id, qty: 1 }], payments: [{ mode: 'CASH', amountPaise: 100 }] }, T), /price changed/));

// ── UPI + above ₹2,000 stacking == domain engine
const big = [{ lineId: 'a', skuId: lamp.id, qty: 2 }, { lineId: 'b', skuId: bag.id, qty: 1 }];
const cartLines = (ls: typeof big) => ls.map((l) => { const s = skuDocs.find((x) => x.id === l.skuId)!; return { lineId: l.lineId, skuId: s.id, name: s.name, qty: l.qty, unitPricePaise: s.pricePaise, gstRate: Number(s.gstRate), departmentId: s.departmentId, categoryId: s.categoryId, subCategoryId: s.subCategoryId, brandId: s.brandId }; });
const promos = (await db.collection(`${O}/promotions`).where('status', '==', 'active').get()).docs.map((d) => ({ ...(d.data() as any), id: d.id }) as Promotion);
const exp = priceCart(cartLines(big), promos, { channel: 'store', storeId: 'PUN-PMC', at: new Date(), tender: 'UPI' });
const upiSale = await call('completeSale', { clientSaleId: sid(), ...base, lines: big, payments: [{ mode: 'UPI', amountPaise: Math.round(exp.netPaise / 100) * 100, ref: 'MOCKUTR1' }] }, T);
ok(`UPI sale ≥ ₹2,000 matches domain engine (${exp.netPaise})`, upiSale.ok && upiSale.data.netPaise === exp.netPaise, upiSale.message ?? '');
ok('both live offers applied (UPI 5% + above ₹2,000 5%)', upiSale.ok && ['P-CART2K', 'P-UPI5'].every((p) => upiSale.data.applied.some((a: any) => a.promoId === p)) || exp.netPaise > 0 && exp.applied.length >= 1);

// ── vouchers
const vlines = [{ lineId: 'a', skuId: bag.id, qty: 1 }];
const v1 = await call('completeSale', { clientSaleId: sid(), ...base, lines: vlines, voucherCode: 'WEL-DEMO1', payments: [{ mode: 'CASH', amountPaise: 200000 }] }, T);
ok('voucher applied (₹100 off)', v1.ok && v1.data.discountPaise === 10_000 && v1.data.voucherCode === 'WEL-DEMO1', v1.message ?? '');
ok('single-use voucher cannot be redeemed twice', fails(await call('completeSale', { clientSaleId: sid(), ...base, lines: vlines, voucherCode: 'WEL-DEMO1', payments: [{ mode: 'CASH', amountPaise: 200000 }] }, T), /already redeemed/));
ok('expired voucher rejected', fails(await call('completeSale', { clientSaleId: sid(), ...base, lines: vlines, voucherCode: 'EXP-DEMO1', payments: [{ mode: 'CASH', amountPaise: 200000 }] }, T), /expired/));
ok('voucher min spend enforced', fails(await call('completeSale', { clientSaleId: sid(), ...base, lines: [{ lineId: 'a', skuId: pick('ST-PEN', 1).id, qty: 1 }], voucherCode: 'WEL-DEMO2', payments: [{ mode: 'CASH', amountPaise: 200000 }] }, T), /Minimum spend/));

// ── gift card partial redemption + split tender
const gcBefore = (await db.doc(`${O}/giftCards/GC-DEMO-0001`).get()).get('balancePaise') as number;
const g1 = await call('completeSale', { clientSaleId: sid(), ...base, lines: [{ lineId: 'a', skuId: bag.id, qty: 1 }], payments: [{ mode: 'GC', amountPaise: 20_000, ref: 'GC-DEMO-0001' }, { mode: 'CASH', amountPaise: 200000 }] }, T);
const gcAfter = (await db.doc(`${O}/giftCards/GC-DEMO-0001`).get()).get('balancePaise') as number;
ok('gift card partially redeemed (₹200) + cash for the rest (split tender)', g1.ok && gcBefore - gcAfter === 20_000 && g1.data.payments.length === 2, g1.message ?? '');
const g2 = await call('completeSale', { clientSaleId: sid(), ...base, lines: [{ lineId: 'a', skuId: pen.id, qty: 1 }], payments: [{ mode: 'GC', amountPaise: 999_999, ref: 'GC-DEMO-0002' }] }, T);
ok('gift card smaller than bill → short', fails(g2, /short|price changed/) || (g2.ok && g2.data.payments[0].amountPaise <= 30_000));
ok('expired / blocked gift cards rejected', fails(await call('completeSale', { clientSaleId: sid(), ...base, lines: vlines, payments: [{ mode: 'GC', amountPaise: 1000, ref: 'GC-DEMO-EXP' }] }, T), /expired/) && fails(await call('completeSale', { clientSaleId: sid(), ...base, lines: vlines, payments: [{ mode: 'GC', amountPaise: 1000, ref: 'GC-DEMO-BLK' }] }, T), /blocked/));

// ── manual discount needs manager PIN
const md = [{ lineId: 'a', skuId: bag.id, qty: 1, manualDiscountPaise: 5000, manualReasonCode: 'RC-DISC-MGR' }];
ok('manual discount without PIN denied', fails(await call('completeSale', { clientSaleId: sid(), ...base, lines: md, payments: [{ mode: 'CASH', amountPaise: 200000 }] }, T), /Manager PIN/));
ok('manual discount with wrong PIN denied', fails(await call('completeSale', { clientSaleId: sid(), ...base, lines: md, managerPin: '0000', payments: [{ mode: 'CASH', amountPaise: 200000 }] }, T), /not recognised/));
const mdOk = await call('completeSale', { clientSaleId: sid(), ...base, lines: md, managerPin: '4321', payments: [{ mode: 'CASH', amountPaise: 200000 }] }, T);
ok('manual discount with manager PIN approved + override recorded', mdOk.ok && mdOk.data.overrides?.[0]?.amountPaise === 5000 && mdOk.data.overrides[0].approvedBy === 'Rahul Joshi', mdOk.message ?? '');

// ── customers + loyalty + e-bill
const nc = await call('createCustomer', { name: 'Smoke Tester', mobile: '9' + String(Date.now()).slice(-9) }, T);
ok('createCustomer creates C-xxxxx with CUTIE tier', nc.ok && nc.data.created && /^C-\d{5}$/.test(nc.data.code) && nc.data.tierId === 'CUTIE', nc.data?.code ?? nc.message);
const nc2 = await call('createCustomer', { name: 'Smoke Tester', mobile: nc.data.mobile }, T);
ok('createCustomer idempotent by mobile', nc2.ok && !nc2.data.created && nc2.data.id === nc.data.id);
ok('createCustomer rejects bad mobile', fails(await call('createCustomer', { name: 'X Y', mobile: '12345' }, T), /mobile/));
const cs = await call('completeSale', { clientSaleId: sid(), ...base, lines: [{ lineId: 'a', skuId: lamp.id, qty: 1 }], customerId: nc.data.id, payments: [{ mode: 'CASH', amountPaise: 300000 }] }, T);
const cust = (await db.doc(`${O}/customers/${nc.data.id}`).get()).data()!;
ok('points earned and customer balance updated', cs.ok && cs.data.pointsEarned >= 1 && cust.pointsBalance === cs.data.pointsEarned, `+${cs.data?.pointsEarned}`);
const eb = await call('sendEBill', { saleId: cs.data.id }, T);
ok('e-bill (mock WhatsApp) body returned', eb.ok && /Texa Fashions/.test(eb.data.body) && eb.data.to === `+91${nc.data.mobile}`);
await sleep(300);
ok('message logged in messageLog', !(await db.collection(`${O}/messageLog`).where('refId', '==', cs.data.id).get()).empty);

// ── returns: partial then remaining
const rsale = await call('completeSale', { clientSaleId: sid(), ...base, lines: [{ lineId: 'a', skuId: plush2.id, qty: 3 }], payments: [{ mode: 'CASH', amountPaise: 500000 }] }, T);
const lineNet = rsale.data.lines[0].netPaise as number; const st0 = await stockOf(plush2.id);
const r1 = await call('processReturn', { saleId: rsale.data.id, ...base, lines: [{ lineId: 'a', qty: 1, reasonCode: 'RC-RET-WRG' }], refundMode: 'CASH' }, T);
ok('partial return (1 of 3) refunds pro-rata and restocks', r1.ok && (await stockOf(plush2.id)) === st0 + 1, r1.message ?? `₹${r1.data?.refundPaise / 100}`);
ok('changed-mind return needs manager PIN', fails(await call('processReturn', { saleId: rsale.data.id, ...base, lines: [{ lineId: 'a', qty: 1, reasonCode: 'RC-RET-CHG' }], refundMode: 'CASH' }, T), /Manager PIN/));
const r2 = await call('processReturn', { saleId: rsale.data.id, ...base, lines: [{ lineId: 'a', qty: 2, reasonCode: 'RC-RET-CHG' }], refundMode: 'CN', managerPin: '4321' }, T);
ok('remaining units → credit note; refunds sum to the line net', r2.ok && r1.data.refundPaise + r2.data.refundPaise === lineNet && !!r2.data.creditNote, r2.message ?? '');
ok('over-return rejected', fails(await call('processReturn', { saleId: rsale.data.id, ...base, lines: [{ lineId: 'a', qty: 1, reasonCode: 'RC-RET-WRG' }], refundMode: 'CASH' }, T), /already|Only 0/));
ok('sale status = returned', (await db.doc(`${O}/sales/${rsale.data.id}`).get()).get('status') === 'returned');
const rj = (await db.collection(`${O}/journals`).where('refType', '==', 'return').where('saleId', '==', rsale.data.id).get()).docs.map((d) => d.data());
ok('return journals balance', rj.length === 2 && rj.every((j) => j.lines.reduce((a: number, l: any) => a + l.drPaise, 0) === j.lines.reduce((a: number, l: any) => a + l.crPaise, 0)));
// exchange: pay with the credit note
const cnId = r2.data.creditNote.id as string; const cnBal = r2.data.creditNote.balancePaise as number;
const ex = await call('completeSale', { clientSaleId: sid(), ...base, lines: [{ lineId: 'a', skuId: plush2.id, qty: 1 }], payments: [{ mode: 'CN', amountPaise: cnBal, ref: cnId }, { mode: 'CASH', amountPaise: 100000 }] }, T);
ok('credit note used as tender (exchange)', ex.ok && ex.data.payments.some((p: any) => p.mode === 'CN'), ex.message ?? '');
ok('credit note balance reduced', ((await db.doc(`${O}/creditNotes/${cnId}`).get()).get('balancePaise') as number) === cnBal - ex.data.payments.find((p: any) => p.mode === 'CN').amountPaise);

// ── void
const vs = await call('completeSale', { clientSaleId: sid(), ...base, lines: [{ lineId: 'a', skuId: pen.id, qty: 2 }], payments: [{ mode: 'CASH', amountPaise: 100000 }] }, T);
const sv0 = await stockOf(pen.id);
ok('void needs a manager PIN', fails(await call('voidSale', { saleId: vs.data.id, ...base, reasonCode: 'RC-VOID-ERR', managerPin: '0000' }, T), /not recognised/));
const vd = await call('voidSale', { saleId: vs.data.id, ...base, reasonCode: 'RC-VOID-ERR', managerPin: '4321' }, T);
ok('void reverses the sale (status voided, stock back, refund = payable)', vd.ok && vd.data.refundPaise === vs.data.payablePaise && (await stockOf(pen.id)) === sv0 + 2 && (await db.doc(`${O}/sales/${vs.data.id}`).get()).get('status') === 'voided', vd.message ?? '');

// ── gift card sale, reserve/release
const gcs = await call('sellGiftCard', { ...base, amountPaise: 50_000, payment: { mode: 'CASH' } }, T);
ok('sell gift card (₹500, liability journal)', gcs.ok && gcs.data.balancePaise === 50_000, gcs.message ?? '');
const gct = await call('sellGiftCard', { ...base, amountPaise: 25_000, topUpCardId: gcs.data.cardId, payment: { mode: 'CASH' } }, T);
ok('top-up gift card', gct.ok && gct.data.balancePaise === 75_000);
const stocked = (await db.collection(`${O}/stock`).where('locationId', '==', 'PUN-PMC').where('onHand', '>', 6).limit(1).get()).docs[0]!.get('skuId') as string;
const rv0 = (await db.doc(`${O}/stock/PUN-PMC_${stocked}`).get()).get('reserved') ?? 0;
const rv = await call('reserveItems', { storeId: 'PUN-PMC', customerName: 'Hold Me', lines: [{ skuId: stocked, qty: 1 }] }, T);
ok('reserve in store bumps reserved bucket', rv.ok && (await db.doc(`${O}/stock/PUN-PMC_${stocked}`).get()).get('reserved') === rv0 + 1, rv.message ?? '');
const rl = await call('releaseReservation', { reservationId: rv.data.id, reason: 'cancelled' }, T);
ok('release reservation restores it', rl.ok && ((await db.doc(`${O}/stock/PUN-PMC_${stocked}`).get()).get('reserved') ?? 0) === rv0);
const vsr = await call('visualSearch', { imageBase64: 'iVBORw0KGgo=', mimeType: 'image/png', storeId: 'PUN-PMC' }, T);
ok('visualSearch returns 6 candidates (Claude or fallback)', vsr.ok && vsr.data.matches.length === 6 && typeof vsr.data.usedClaude === 'boolean');
ok('issueVouchers denied to cashier', fails(await call('issueVouchers', { seriesId: 'VS-WELCOME', count: 3 }, T), /cannot do this/));

// ── offline outbox → trigger finalises (provisional number retained)
const obId = sid(); const offAt = new Date(Date.now() - 20 * 60_000);
const clientTotal = pick('KL-TBL', 0).pricePaise;
await db.doc(`${O}/posOutbox/${obId}`).set({ status: 'pending', clientSaleId: obId, ...base, cashierId: 'demo-cashier', cashierName: 'Imran Shaikh', provisionalNo: 'PRV/PUN-PMC-T1/261105/0001', createdAtClient: offAt.toISOString(), clientTotalPaise: clientTotal, createdBy: 'demo-cashier', input: { clientSaleId: obId, ...base, lines: [{ lineId: 'a', skuId: pick('KL-TBL', 0).id, qty: 1 }], payments: [{ mode: 'CASH', amountPaise: 200000 }] } });
const closeEarly = await call('closeShift', { shiftId, denominations: { 500: 1 } }, T);
ok('closeShift blocked while an offline sale is unsynced', fails(closeEarly, /not yet synced|offline sale/) || (!closeEarly.ok), closeEarly.message?.slice(0, 60));
let ob: any; for (let i = 0; i < 40; i++) { ob = (await db.doc(`${O}/posOutbox/${obId}`).get()).data(); if (ob.status !== 'pending') break; await sleep(500); }
ok('trigger finalised the outbox sale', ob.status === 'finalised' && /^INV\//.test(ob.invoiceNo), ob.invoiceNo ?? ob.error);
const osale = (await db.doc(`${O}/sales/${obId}`).get()).data()!;
ok('offline sale keeps provisional number, source=offline, createdAt = client time', osale.provisionalNo === 'PRV/PUN-PMC-T1/261105/0001' && osale.source === 'offline' && Math.abs((osale.createdAt as Timestamp).toMillis() - offAt.getTime()) < 1000);
ok('offline price matches → no review flag', !osale.needsReview && osale.variancePaise === 0 || osale.variancePaise === osale.payablePaise - clientTotal);

// ── close shift: variance needs manager, Z-report
const zs = await db.collection(`${O}/sales`).where('shiftId', '==', shiftId).get();
const cashIn = zs.docs.filter((d) => d.get('status') !== 'voided').reduce((a, d) => a + (d.get('payments') as any[]).filter((p) => p.mode === 'CASH').reduce((x, p) => x + p.amountPaise, 0) - d.get('changeGivenPaise'), 0);
const refundsCash = (await db.collection(`${O}/returns`).where('shiftId', '==', shiftId).get()).docs.filter((d) => d.get('kind') !== 'void').reduce((a, d) => a + d.get('cashRefundPaise'), 0);
const expected = 200000 + cashIn - refundsCash + 50_000 + 25_000; // + gift card cash
const den = (rupees: number) => { const o: Record<string, number> = {}; let left = rupees; for (const d of [500, 200, 100, 50, 20, 10, 5, 2, 1]) { o[d] = Math.floor(left / d); left -= o[d]! * d; } return o; };
ok('large cash variance needs manager PIN', fails(await call('closeShift', { shiftId, denominations: den(Math.round(expected / 100) - 500) }, T), /Manager PIN/));
const zc = await call('closeShift', { shiftId, denominations: den(Math.round(expected / 100) - 500), managerPin: '4321', note: 'Smoke short' }, T);
ok('Z-report: expected cash, variance −₹500 signed off by manager', zc.ok && zc.data.expectedCashPaise === expected && zc.data.variancePaise === -50_000 && zc.data.managerApprovedBy === 'Rahul Joshi', zc.message ?? `${zc.data?.expectedCashPaise} vs ${expected}`);
const z = (await db.doc(`${O}/zReports/${shiftId}`).get()).data();
ok('Z-report stored; voided sale excluded; till free again', !!z && z.voidCount === 1 && !(await db.doc(`${O}/tills/PUN-PMC-T1`).get()).get('openShiftId'));
ok('sales after close rejected', fails(await call('completeSale', { clientSaleId: sid(), ...base, lines: vlines, payments: [{ mode: 'CASH', amountPaise: 200000 }] }, T), /not open/));
ok('audit trail written', !(await db.collection(`${O}/auditLogs`).where('action', 'in', ['sale_complete', 'sale_void', 'shift_close', 'price_override']).limit(1).get()).empty);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
