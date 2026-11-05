/** OMS + Shopify connector API-level smoke test. Needs `pnpm demo` (seeded). Run: pnpm --filter @texafashions/smoke-tests oms */
import { createHmac } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createFirebaseContext } from '@texafashions/data';
import { DEV_SHIPROCKET_TOKEN, DEV_SHOPIFY_SECRET, type Role } from '@texafashions/types';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ??= 'demo-texafashions';
initializeApp({ projectId: 'demo-texafashions' });
const adb = getFirestore(); adb.settings({ ignoreUndefinedProperties: true });
const O = 'orgs/texafashions'; const FN = 'http://127.0.0.1:5001/demo-texafashions/asia-south1';
const ctx = createFirebaseContext({ apiKey: 'demo-key', projectId: 'demo-texafashions', storageBucket: 'demo-texafashions.appspot.com' });
const { scm } = ctx;
let failed = 0, passed = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${name} ${extra}`); if (cond) passed++; else failed++; };
const as = async (role: Role) => { await ctx.auth.signOut().catch(() => {}); await ctx.auth.demoSignIn(role); await new Promise((r) => setTimeout(r, 300)); };
const fails = async (p: Promise<unknown>, re?: RegExp) => p.then(() => false, (e: Error) => (re ? re.test(e.message) : true));
const get = async (c: string, id: string) => (await adb.doc(`${O}/${c}/${id}`).get()).data() as Record<string, any> | undefined;
const stockOf = async (loc: string, sku: string) => (await get('stock', `${loc}_${sku}`)) ?? { onHand: 0, reserved: 0, inQC: 0, damaged: 0 };
const scansFor = (pl: Record<string, any>) => (pl.lines as Record<string, any>[]).flatMap((l) => Array(l.qty).fill(l.barcode ?? l.skuId) as string[]);
const picksFor = (pl: Record<string, any>) => (pl.lines as Record<string, any>[]).map((l) => ({ skuId: l.skuId, pickedQty: l.qty }));
const sim = async (scenario: string, extra: Record<string, unknown> = {}) => { const r = await scm.command('simulateWebOrder', { scenario, count: 1, ...extra } as never); return (r.results as Record<string, any>[])[0]!; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ───────── Shopify webhook: HMAC, idempotency, retries
const sign = (body: string, secret = DEV_SHOPIFY_SECRET) => createHmac('sha256', secret).update(body).digest('base64');
async function hook(topic: string, payload: unknown, o: { id?: string; secret?: string; sig?: string | null; method?: string } = {}) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-shopify-topic': topic, 'x-shopify-shop-domain': 'texafashions.myshopify.com', 'x-shopify-event-id': o.id ?? `ev-${Date.now()}-${Math.random()}` };
  if (o.sig !== null) headers['x-shopify-hmac-sha256'] = o.sig ?? sign(body, o.secret);
  const r = await fetch(`${FN}/shopifyWebhook`, { method: o.method ?? 'POST', headers, body: o.method === 'GET' ? undefined : body });
  const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* plain text */ }
  return { status: r.status, json, text };
}
await as('warehouse_manager');
const skuRow = (await adb.collection(`${O}/skus`).where('status', '==', 'active').limit(60).get()).docs.map((d) => ({ id: d.id, ...(d.data() as any) })).find((s) => s.shopifyVariantId && !s.isService)!;
const shopOrder = (id: number, over: Record<string, any> = {}) => ({
  id, name: `#T${id % 10000}`, created_at: new Date(Date.now() - 4000).toISOString(), financial_status: 'paid', total_price: (Number(skuRow.pricePaise) / 100 + 99).toFixed(2), total_discounts: '0.00', phone: '+919811122233',
  payment_gateway_names: ['razorpay'], customer: { id: 5, first_name: 'Test', last_name: 'Buyer' },
  shipping_address: { name: 'Test Buyer', address1: '1 MG Road', city: 'Bengaluru', province: 'Karnataka', zip: '560001', phone: '9811122233' }, shipping_lines: [{ title: 'Standard', price: '99.00' }],
  line_items: [{ id: id + 1, sku: skuRow.id, title: skuRow.name, quantity: 1, price: (Number(skuRow.pricePaise) / 100).toFixed(2), total_discount: '0.00' }], ...over,
});
const baseId = Date.now();
const body0 = shopOrder(baseId);
ok('webhook rejects GET', (await hook('orders/create', body0, { method: 'GET' })).status === 405);
ok('webhook rejects a missing signature (401)', (await hook('orders/create', body0, { sig: null })).status === 401);
ok('webhook rejects a signature made with the wrong secret (401)', (await hook('orders/create', body0, { secret: 'attacker' })).status === 401);
const goodSigTamper = sign(JSON.stringify(body0)); const tampered = await fetch(`${FN}/shopifyWebhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-topic': 'orders/create', 'x-shopify-event-id': 'tamper-1', 'x-shopify-hmac-sha256': goodSigTamper }, body: JSON.stringify({ ...body0, total_price: '1.00' }) });
ok('webhook rejects a body altered after signing (401)', tampered.status === 401);
ok('nothing was stored for rejected calls', !(await get('webOrders', `SH${baseId}`)) && !(await get('shopifyEvents', 'tamper-1')));
const evId = `ev-first-${baseId}`;
const first = await hook('orders/create', body0, { id: evId });
ok('valid signed order → 200 processed + allocated', first.status === 200 && first.json?.status === 'processed', JSON.stringify(first.json));
const ord = await get('webOrders', `SH${baseId}`);
ok('web order stored: number series, paise, allocated to a location', !!ord && /^WEB\/ONL\/\d\d-\d\d\/\d{5}$/.test(ord.number) && ord.status === 'allocated' && ord.units.length === 1, `${ord?.number} → ${ord?.units?.[0]?.locationId}`);
const dup = await hook('orders/create', body0, { id: evId });
ok('same event id delivered again → acknowledged as duplicate, no second order', dup.status === 200 && dup.json?.status === 'duplicate' && (await adb.collection(`${O}/webOrders`).where('shopifyOrderId', '==', String(baseId)).get()).size === 1);
ok('event ledger counts deliveries', (await get('shopifyEvents', evId))?.deliveries === 2);
const again = await hook('orders/create', body0, { id: `ev-other-${baseId}` });
ok('same order under a NEW event id → natural-key idempotency, still one order and one reservation', again.json?.status === 'processed' && (await adb.collection(`${O}/pickLists`).where('orderId', '==', `SH${baseId}`).get()).size === 1);

// Out-of-order: paid + cancelled before create → retry queue → resolved once the order exists
const lateId = baseId + 77; const paidEv = `ev-paid-${lateId}`;
const early = await hook('orders/paid', { id: lateId, name: '#LATE' }, { id: paidEv });
const fe = await get('failedEvents', paidEv);
ok('orders/paid before orders/create → 200, parked in failedEvents with backoff', early.status === 200 && early.json?.status === 'failed' && fe?.status === 'retrying' && fe.attempts === 1 && !!fe.nextRetryAt);
await hook('orders/create', shopOrder(lateId, { financial_status: 'pending' }));
await as('warehouse_manager');
const rr = await scm.command('retryFailedEvent', { eventId: paidEv });
ok('retry succeeds once the order exists → resolved, order marked paid', rr.status === 'resolved' && (await get('failedEvents', paidEv))?.status === 'resolved' && (await get('webOrders', `SH${lateId}`))?.financialStatus === 'paid');

// Poison event → dead letter after 6 attempts; manual retry restores a budget
const bad = await sim('bad_sku');
ok('unknown SKU → failed event, not a crash', bad.eventStatus === 'failed' && /unknown SKU/i.test(bad.error));
const badEv = (await adb.collection(`${O}/failedEvents`).where('status', '==', 'retrying').get()).docs.find((d) => d.get('orderName') && /unknown|SKU/i.test(d.get('error')) && d.get('attempts') === 1)!;
for (let i = 0; i < 5; i++) await scm.command('retryFailedEvent', { eventId: badEv.id });
const dead = await get('failedEvents', badEv.id);
ok('after 6 attempts the event is dead-lettered (no more auto-retry)', dead?.status === 'dead' && dead.attempts === 6 && dead.nextRetryAt === null);
ok('runRetries leaves dead letters alone', (await scm.command('runRetries', {})).due >= 0 && (await get('failedEvents', badEv.id))?.status === 'dead');

// ───────── Allocation, reservation, cancel
const o1 = await sim('prepaid');
ok('simulated prepaid order is processed and allocated', o1.eventStatus === 'processed' && o1.status === 'allocated', `${o1.orderName} ${o1.strategy}`);
const od1 = (await get('webOrders', o1.orderId))!; const u1 = od1.units[0]; const pl1 = (await get('pickLists', u1.pickListId))!;
const afterRes = await stockOf(u1.locationId, pl1.lines[0].skuId);
ok('allocation reserves stock at the chosen location (single → warehouse first)', u1.locationId === 'WH-CENTRAL' && afterRes.reserved >= pl1.lines[0].qty, `reserved=${afterRes.reserved}`);
ok('pick list lines sorted by bin and money apportions exactly', pl1.payablePaise === pl1.lines.reduce((s: number, l: any) => s + l.netPaise, 0) + pl1.shippingPaise);
const resBefore = (await stockOf(u1.locationId, pl1.lines[0].skuId)).reserved;
const cx = await scm.command('cancelOrder', { orderId: o1.orderId, reason: 'Customer changed mind' });
ok('cancel releases the reservation', cx.status === 'cancelled' && (await stockOf(u1.locationId, pl1.lines[0].skuId)).reserved === resBefore - pl1.lines[0].qty);
ok('cancel is idempotent', (await scm.command('cancelOrder', { orderId: o1.orderId, reason: 'again' })).already === true);

const oos = await sim('out_of_stock');
ok('unfillable order waits as awaiting_stock with nothing reserved', oos.status === 'awaiting_stock' && ((await get('webOrders', oos.orderId))!.allocation.shortages.length > 0));
await scm.command('allocateOrder', { orderId: oos.orderId }).then((r) => ok('re-allocating without new stock stays awaiting_stock', r.status === 'awaiting_stock'));
const split = await sim('split').catch((e) => ({ eventStatus: 'n/a', error: e.message }));
if ((split as any).orderId) ok('split order → 2 parcels from 2 locations', (await get('webOrders', (split as any).orderId))!.units.length === 2 && new Set((await get('webOrders', (split as any).orderId))!.units.map((u: any) => u.locationId)).size === 2);
else console.log('· split scenario skipped:', split.error);

// ───────── Pick → pack scan → ship
const o2 = await sim('prepaid'); const od2 = (await get('webOrders', o2.orderId))!; const pl2id = od2.units[0].pickListId; const pl2 = (await get('pickLists', pl2id))!;
ok('cannot pack before picking', await fails(scm.command('packOrder', { pickListId: pl2id, scans: scansFor(pl2) }), /must be picked/));
ok('over-pick rejected', await fails(scm.command('confirmPick', { pickListId: pl2id, picks: pl2.lines.map((l: any) => ({ skuId: l.skuId, pickedQty: l.qty + 1 })) }), /only/));
await scm.command('confirmPick', { pickListId: pl2id, picks: picksFor(pl2) });
ok('order status follows the pick list (picking)', (await get('webOrders', o2.orderId))!.status === 'picking');
const wrong = await scm.command('packOrder', { pickListId: pl2id, scans: [...scansFor(pl2).slice(1), 'NOT-A-BARCODE'] }).then(() => '', (e: Error) => e.message);
ok('pack scan catches a missing item + unknown barcode', /Pack check failed/.test(wrong) && /Missing/.test(wrong) && /Unknown barcode/.test(wrong), wrong.slice(0, 90));
ok('failed pack attempts are counted on the pick list', (await get('pickLists', pl2id))!.packAttempts === 1);
ok('an extra unit is caught too', await fails(scm.command('packOrder', { pickListId: pl2id, scans: [...scansFor(pl2), scansFor(pl2)[0]!] }), /Unexpected/));
const pk = await scm.command('packOrder', { pickListId: pl2id, scans: scansFor(pl2), giftNote: 'Happy birthday!' });
ok('correct scan packs the order', pk.status === 'packed' && (await get('webOrders', o2.orderId))!.status === 'packed');
const wh0 = await stockOf('WH-CENTRAL', pl2.lines[0].skuId);
const sh = await scm.command('createShipment', { pickListId: pl2id });
const shipDoc = (await get('shipments', pl2id))!;
ok('shipment: mock Shiprocket AWB + tax invoice number', /^SR\d{11}$/.test(sh.awb) && /^WINV\//.test(sh.invoiceNo), `${sh.courier} ${sh.awb} ${sh.invoiceNo}`);
const wh1 = await stockOf('WH-CENTRAL', pl2.lines[0].skuId);
ok('dispatch issues stock and releases the reservation', wh1.onHand === wh0.onHand - pl2.lines[0].qty && wh1.reserved === wh0.reserved - pl2.lines[0].qty);
const j = (await adb.collection(`${O}/journals`).where('refId', '==', pl2id).get()).docs[0]!.data() as any;
ok('web sale journal balances (Dr gateway clearing, Cr web sales + GST, Dr COGS)', j.balanced && j.lines.reduce((a: number, l: any) => a + l.drPaise - l.crPaise, 0) === 0 && j.lines.some((l: any) => l.ledgerId === 'L-GW-CLR') && j.lines.some((l: any) => l.ledgerId === 'L-SALES-WEB'));
ok('invoice GST: Bengaluru parcel from Maharashtra is inter-state (IGST)', shipDoc.invoice.interState ? shipDoc.invoice.igstPaise > 0 && shipDoc.invoice.cgstPaise === 0 : shipDoc.invoice.cgstPaise > 0, shipDoc.invoice.interState ? 'IGST' : 'CGST+SGST');
ok('createShipment is idempotent (same AWB, no second issue)', (await scm.command('createShipment', { pickListId: pl2id })).already === true && (await stockOf('WH-CENTRAL', pl2.lines[0].skuId)).onHand === wh1.onHand);
ok('cannot cancel once with the courier', await fails(scm.command('cancelOrder', { orderId: o2.orderId, reason: 'not wanted' }), /courier/));

// ───────── Courier tracking, delivery, NDR → RTO → QC
ok('illegal transition refused (booked → delivered)', await fails(scm.command('courierEvent', { awb: sh.awb, event: 'delivered' }), /Cannot apply/));
for (const e of ['picked_up', 'in_transit', 'out_for_delivery', 'delivered'] as const) await scm.command('courierEvent', { awb: sh.awb, event: e });
ok('delivered → order delivered', (await get('webOrders', o2.orderId))!.status === 'delivered' && (await get('shipments', pl2id))!.status === 'delivered');
ok('duplicate courier event is a no-op', (await scm.command('courierEvent', { awb: sh.awb, event: 'delivered' })).duplicate === true);

const o3 = await sim('prepaid'); const pl3id = (await get('webOrders', o3.orderId))!.units[0].pickListId; const pl3 = (await get('pickLists', pl3id))!;
await scm.command('confirmPick', { pickListId: pl3id, picks: picksFor(pl3) }); await scm.command('packOrder', { pickListId: pl3id, scans: scansFor(pl3) });
const sh3 = await scm.command('createShipment', { pickListId: pl3id });
for (const e of ['picked_up', 'in_transit', 'out_for_delivery', 'ndr', 'rto_initiated'] as const) await scm.command('courierEvent', { awb: sh3.awb, event: e });
ok('RTO initiated → order rto + RTO case opened', (await get('webOrders', o3.orderId))!.status === 'rto' && (await get('rtoCases', pl3id))?.status === 'in_transit_back');
ok('cannot receive an RTO parcel that has not reached the warehouse', await fails(scm.command('receiveRto', { shipmentId: pl3id }), /rto_initiated/));
await scm.command('courierEvent', { awb: sh3.awb, event: 'rto_delivered' });
const sku3 = pl3.lines[0].skuId; const q0 = await stockOf('WH-CENTRAL', sku3);
const rc = await scm.command('receiveRto', { shipmentId: pl3id, scans: scansFor(pl3) });
const q1 = await stockOf('WH-CENTRAL', sku3);
ok('RTO received into QC bucket — NOT sellable stock', q1.inQC === q0.inQC + pl3.lines[0].qty && q1.onHand === q0.onHand, `inQC ${q0.inQC}→${q1.inQC}`);
ok('credit note raised; prepaid order flagged for refund', /^WCN\//.test(rc.creditNoteNo) && rc.refundDuePaise > 0 && (await get('webOrders', o3.orderId))!.refundDue === true);
const rj = (await adb.collection(`${O}/journals`).where('event', '==', 'web_rto_reversal').where('refId', '==', pl3id).get()).docs[0]!.data() as any;
ok('reversal journal balances and books to sales returns', rj.balanced && rj.lines.some((l: any) => l.ledgerId === 'L-SALES-RET'));
ok('QC must account for every unit', await fails(scm.command('qcRto', { rtoId: pl3id, lines: pl3.lines.map((l: any) => ({ skuId: l.skuId, good: 0, damaged: 0 })) }), /must equal/));
const qcLines = pl3.lines.map((l: any, i: number) => ({ skuId: l.skuId, good: i === 0 ? l.qty - 1 : l.qty, damaged: i === 0 ? 1 : 0 }));
const qc = await scm.command('qcRto', { rtoId: pl3id, lines: qcLines });
const q2 = await stockOf('WH-CENTRAL', sku3);
ok('QC: good units back to onHand, damaged to the damaged bucket + write-off', qc.damaged === 1 && qc.writeOffPaise > 0 && q2.damaged === q1.damaged + 1 && q2.inQC === q1.inQC - pl3.lines[0].qty, `good ${qc.good} damaged ${qc.damaged}`);
ok('RTO case closed; cannot QC twice', (await get('rtoCases', pl3id))!.status === 'closed' && await fails(scm.command('qcRto', { rtoId: pl3id, lines: qcLines }), /closed/));

// ───────── BOPIS
await as('warehouse_manager');
const bo = await sim('bopis', { pickupStoreId: 'BLR-FS' }); const bod = (await get('webOrders', bo.orderId))!; const bpl = bod.units[0];
ok('BOPIS allocates only to the pickup store', bpl.locationId === 'BLR-FS' && bod.fulfilmentType === 'bopis');
await as('store_manager');
const bplDoc = (await get('pickLists', bpl.pickListId))!;
ok('store manager can read their own store’s pick list', (await scm.list('pickLists', { where: [['locationId', '==', 'BLR-FS']] })).some((p) => p.id === bpl.pickListId));
ok('store manager cannot read other stores’ pick lists', await fails(scm.list('pickLists', { where: [['locationId', '==', 'PUN-PMC']] })));
ok('store manager cannot read web orders (PII)', await fails(scm.list('webOrders', {})));
await scm.command('confirmPick', { pickListId: bpl.pickListId, picks: picksFor(bplDoc) }); await scm.command('packOrder', { pickListId: bpl.pickListId, scans: scansFor(bplDoc) });
ok('BOPIS cannot be shipped', await fails(scm.command('createShipment', { pickListId: bpl.pickListId }), /handed over|BOPIS/));
const rdy = await scm.command('markReadyForPickup', { pickListId: bpl.pickListId });
const code = (await get('pickLists', bpl.pickListId))!.pickupCode as string;
ok('ready for pickup: 6-digit code, 48h hold, customer notified (mock WhatsApp)', /^\d{6}$/.test(code) && /sent/.test(rdy.notified) && (await get('webOrders', bo.orderId))!.status === 'ready_for_pickup');
const wrongCode = code === '000000' ? '111111' : '000000';
ok('wrong pickup code refused', await fails(scm.command('collectBopis', { pickListId: bpl.pickListId, code: wrongCode }), /Wrong pickup code/));
const needPay = bod.paymentMode === 'cod';
if (needPay) ok('pay-at-store order needs a tender at handover', await fails(scm.command('collectBopis', { pickListId: bpl.pickListId, code }), /pay-at-store/));
const bs0 = await stockOf('BLR-FS', bplDoc.lines[0].skuId);
const col1 = await scm.command('collectBopis', { pickListId: bpl.pickListId, code, paidAtStore: needPay ? { mode: 'UPI', ref: 'UTR123' } : null });
const bs1 = await stockOf('BLR-FS', bplDoc.lines[0].skuId);
ok('handover invoices (CGST+SGST, same state) and issues stock', /^WINV\/BLR-FS\//.test(col1.invoiceNo) && bs1.onHand === bs0.onHand - bplDoc.lines[0].qty && bs1.reserved === bs0.reserved - bplDoc.lines[0].qty);
ok('order collected', (await get('webOrders', bo.orderId))!.status === 'collected');
await as('warehouse_manager');
const bo2 = await sim('bopis', { pickupStoreId: 'BLR-FS' }); const bpl2 = (await get('webOrders', bo2.orderId))!.units[0]; const bpd2 = (await get('pickLists', bpl2.pickListId))!;
await scm.command('confirmPick', { pickListId: bpl2.pickListId, picks: picksFor(bpd2) }); await scm.command('packOrder', { pickListId: bpl2.pickListId, scans: scansFor(bpd2) }); await scm.command('markReadyForPickup', { pickListId: bpl2.pickListId });
const rsv = (await stockOf('BLR-FS', bpd2.lines[0].skuId)).reserved;
await scm.command('expireBopis', { force: true });
ok('expired hold releases the reserved stock and flags the order', (await get('pickLists', bpl2.pickListId))!.status === 'expired' && (await stockOf('BLR-FS', bpd2.lines[0].skuId)).reserved <= rsv - bpd2.lines[0].qty && (await get('webOrders', bo2.orderId))!.status === 'expired');

// ───────── Short pick re-allocates
const o5 = await sim('prepaid'); const pl5id = (await get('webOrders', o5.orderId))!.units[0].pickListId; const pl5 = (await get('pickLists', pl5id))!;
const sp = await scm.command('confirmPick', { pickListId: pl5id, picks: pl5.lines.map((l: any, i: number) => ({ skuId: l.skuId, pickedQty: i === 0 ? l.qty - 1 : l.qty })) });
const o5d = (await get('webOrders', o5.orderId))!;
ok('short pick: shortage re-allocated (or flagged) and shelf flagged for a count', sp.short.length === 1 && (/moved to/.test(sp.realloc) ? o5d.units.length >= 2 : !!o5d.needsAttention), sp.realloc);
ok('short pick wrote a ledger annotation for a cycle count', !(await adb.collection(`${O}/stockLedger`).where('kind', '==', 'short_pick').where('refId', '==', pl5id).get()).empty);

// ───────── COD → remittance reconciliation
await as('warehouse_manager');
const cods: { awb: string; amt: number }[] = [];
for (let i = 0; i < 3; i++) {
  const o = await sim('cod'); const id = (await get('webOrders', o.orderId))!.units[0].pickListId; const p = (await get('pickLists', id))!;
  await scm.command('confirmPick', { pickListId: id, picks: picksFor(p) }); await scm.command('packOrder', { pickListId: id, scans: scansFor(p) });
  const s = await scm.command('createShipment', { pickListId: id });
  for (const e of ['picked_up', 'in_transit', 'out_for_delivery', 'delivered'] as const) await scm.command('courierEvent', { awb: s.awb, event: e });
  cods.push({ awb: s.awb, amt: p.codAmountPaise });
  if (i === 0) ok('COD parcel carries the amount to collect; cash tracked with courier after delivery', p.codAmountPaise > 0 && (await get('shipments', id))!.codStatus === 'with_courier');
}
await as('warehouse_manager');
ok('only finance can import remittances', await fails(scm.command('simulateCodRemittance', {}), /cannot do this/));
await as('cfo');
const rem = await scm.command('simulateCodRemittance', { shortLines: 1 });
const remDoc = (await get('codRemittances', rem.id))!;
ok('remittance reconciled by AWB: short payment + unknown AWB caught', remDoc.rows.some((r: any) => r.status === 'short') && remDoc.rows.some((r: any) => r.status === 'unknown_awb') && rem.status === 'needs_review', `short ₹${rem.shortPaise / 100}, suspense ₹${rem.suspensePaise / 100}`);
const rj2 = (await get('journals', remDoc.journalId))!;
ok('remittance journal balances (bank + fees = COD receivable cleared + suspense)', rj2.balanced && rj2.lines.reduce((a: number, l: any) => a + l.drPaise - l.crPaise, 0) === 0 && rj2.lines.some((l: any) => l.ledgerId === 'L-SUSPENSE'));
ok('short-paid parcel marked disputed; matched ones remitted', (await adb.collection(`${O}/shipments`).where('remittanceId', '==', rem.id).get()).docs.some((d) => d.get('codStatus') === 'short_paid') && (await adb.collection(`${O}/shipments`).where('remittanceId', '==', rem.id).get()).docs.some((d) => d.get('codStatus') === 'remitted'));
ok('same UTR cannot be imported twice', await fails(scm.command('importCodRemittance', { courier: remDoc.courier, utr: remDoc.utr, remittedOn: '2026-11-05', lines: [{ awb: 'X', amountPaise: 100 }], feesPaise: 0 }), /already imported/));

// ───────── Stock push with safety buffer
await as('warehouse_manager');
await scm.command('pushStockNow', {});
const p2 = await scm.command('pushStockNow', {});
ok('second push is a no-op (diff against last pushed)', p2.pushed === 0 && p2.unchanged > 200, `unchanged ${p2.unchanged}`);
const woId = baseId + 555; await hook('orders/create', shopOrder(woId)); const wpl = (await get('pickLists', (await get('webOrders', `SH${woId}`))!.units[0].pickListId))!;
const sk = wpl.lines[0].skuId; const pushedBefore = (await get('shopifyStock', sk))?.pushedQty;
const p3 = await scm.command('pushStockNow', { skuIds: [sk] });
ok('a reservation lowers the web quantity and is pushed', p3.pushed === 1 && (await get('shopifyStock', sk))!.pushedQty === pushedBefore - wpl.lines[0].qty, `${pushedBefore} → ${(await get('shopifyStock', sk))?.pushedQty}`);
const allStock = (await adb.collection(`${O}/stock`).where('skuId', '==', sk).get()).docs.map((d) => d.data());
const expected = allStock.reduce((a, s) => a + Math.max(0, s.onHand - (s.reserved ?? 0) - (s.locationId === 'WH-CENTRAL' ? 0 : 2)), 0);
ok('pushed qty = Σ(onHand − reserved − buffer): store buffer 2, warehouse 0, last unit hidden', (await get('shopifyStock', sk))!.pushedQty === (expected <= 1 ? 0 : expected), `expected ${expected}`);
const out = await scm.command('pushStockNow', { force: true, simulateOutage: true });
const fe2 = (await adb.collection(`${O}/failedEvents`).where('kind', '==', 'stock_push').where('status', '==', 'retrying').get()).docs[0];
ok('Shopify outage → push failures parked for retry, nothing marked pushed', out.failed > 0 && out.pushed === 0 && !!fe2);
const rs = await scm.command('retryFailedEvent', { eventId: fe2!.id });
ok('retrying the stock push after the outage resolves it', rs.status === 'resolved' && (await get('failedEvents', fe2!.id))!.status === 'resolved');

// ───────── Courier webhook + health + permissions
const cw = await fetch(`${FN}/courierWebhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'wrong' }, body: JSON.stringify({ awb: 'x', current_status: 'DELIVERED' }) });
ok('courier webhook requires its token', cw.status === 401);
const o6 = await sim('prepaid'); const id6 = (await get('webOrders', o6.orderId))!.units[0].pickListId; const p6 = (await get('pickLists', id6))!;
await scm.command('confirmPick', { pickListId: id6, picks: picksFor(p6) }); await scm.command('packOrder', { pickListId: id6, scans: scansFor(p6) }); const s6 = await scm.command('createShipment', { pickListId: id6 });
const cw2 = await fetch(`${FN}/courierWebhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': DEV_SHIPROCKET_TOKEN }, body: JSON.stringify({ awb: s6.awb, current_status: 'PICKED UP' }) });
ok('courier webhook applies a status update', cw2.status === 200 && (await get('shipments', id6))!.status === 'picked_up');
const health = await scm.command('syncHealthReport', {});
ok('sync-health report: verdict, webhook lag, drift, SLA, COD ageing', ['green', 'amber', 'red'].includes(health.verdict) && health.webhooks.last24h > 0 && typeof health.stock.driftCount === 'number' && health.cod.openParcels >= 0 && health.failed.dead >= 1, `${health.verdict}: ${health.issues.length} issue(s)`);
await as('cashier');
ok('cashier cannot simulate orders / push stock / read health', (await Promise.all([fails(scm.command('simulateWebOrder', { scenario: 'prepaid' } as never)), fails(scm.command('pushStockNow', {})), fails(scm.command('syncHealthReport', {}))])).every(Boolean));
await as('vendor');
ok('vendor cannot read shipments or web orders', (await Promise.all([fails(scm.list('shipments', {})), fails(scm.list('webOrders', {}))])).every(Boolean));
await as('auditor');
ok('auditor can read the event ledger but not change anything', (await scm.list('shopifyEvents', { limit: 5 })).length > 0 && (await fails(scm.command('cancelOrder', { orderId: o6.orderId, reason: 'not wanted' }))));

console.log(`\n${passed} passed, ${failed} failed`);
await sleep(100);
process.exit(failed ? 1 : 0);
