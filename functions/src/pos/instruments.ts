import { HttpsError } from 'firebase-functions/v2/https';
import type { z } from 'zod';
import type { CreateCustomerInput, IssueVouchersInput, ReleaseReservationInput, ReserveItemsInput, SellGiftCardInput, SendEBillInput, VisualSearchInput } from '@texafashions/types';
import { MASTER_MAP, searchKeywordsFor } from '@texafashions/types';
import { buildGiftCardSaleJournal, topUpGiftCard } from '@texafashions/domain';
import { FieldValue, Timestamp, col, db, type Caller } from '../admin';
import { getClaude, CLAUDE_MODEL } from '../claude';
import { StockEngine, audit, fail, must, requireLocation, requireRoles, reserveNumber, ymd } from '../engine';
import { sendEBillFor } from './ebill';
import { plain, sanitiseId } from './util';

type Doc = Record<string, any>;

// ───────────────────────── gift cards
export async function sellGiftCard(c: Caller, i: z.output<typeof SellGiftCardInput>) {
  requireRoles(c, 'cashier', 'store_manager'); requireLocation(c, i.storeId);
  const series = ((await col('giftCardSeries').doc(i.seriesId).get()).data() as Doc | undefined) ?? { kind: 'Physical', validityMonths: 12 };
  const at = new Date();
  return db.runTransaction(async (tx) => {
    const shiftRef = col('shifts').doc(i.shiftId);
    const cardRef0 = i.topUpCardId ? col('giftCards').doc(i.topUpCardId) : null;
    const [shiftSnap, cardSnap] = await Promise.all([tx.get(shiftRef), cardRef0 ? tx.get(cardRef0) : Promise.resolve(null)]);
    const shift = must(shiftSnap.data() as Doc | undefined, 'Shift not found');
    if (shift.status !== 'open' || shift.storeId !== i.storeId || shift.tillId !== i.tillId) fail('Shift is not open on this till');
    let cardId: string, balance: number;
    const num = await reserveNumber(tx, 'GC', i.storeId);
    if (cardRef0) {
      if (!cardSnap?.exists) fail(`Gift card ${i.topUpCardId} not found`);
      const r = topUpGiftCard({ id: cardRef0.id, ...(cardSnap!.data() as Doc) } as never, i.amountPaise, at);
      if (!r.ok) fail(r.reason);
      cardId = cardRef0.id; balance = r.balancePaise;
      tx.update(cardRef0, { balancePaise: balance, updatedAt: FieldValue.serverTimestamp() });
    } else {
      cardId = sanitiseId(num.number); balance = i.amountPaise; num.write();
      const exp = new Date(at); exp.setUTCMonth(exp.getUTCMonth() + (series.validityMonths ?? 12));
      tx.set(col('giftCards').doc(cardId), { seriesId: i.seriesId, kind: series.kind ?? 'Physical', balancePaise: balance, initialPaise: i.amountPaise, status: 'active', expiresAt: exp.toISOString().slice(0, 10), storeId: i.storeId, customerId: i.customerId ?? null, issuedAt: FieldValue.serverTimestamp() });
    }
    tx.set(col('giftCards').doc(cardId).collection('txns').doc(), { kind: cardRef0 ? 'topup' : 'issue', amountPaise: i.amountPaise, balanceAfterPaise: balance, storeId: i.storeId, tender: i.payment.mode, at: FieldValue.serverTimestamp() });
    const lines = buildGiftCardSaleJournal(i.amountPaise, i.payment.mode, cardId);
    tx.set(col('journals').doc(), { event: 'gift_card_sale', refType: 'giftCard', refId: cardId, storeId: i.storeId, day: ymd(at), lines, balanced: true, at: FieldValue.serverTimestamp() });
    if (i.payment.mode === 'CASH') tx.update(shiftRef, { giftCardCashPaise: FieldValue.increment(i.amountPaise) });
    audit(tx, c, { action: cardRef0 ? 'gift_card_topup' : 'gift_card_issue', entity: 'giftCards', entityId: cardId, before: null, after: { amountPaise: i.amountPaise, balancePaise: balance } });
    return { cardId, balancePaise: balance, topUp: !!cardRef0 };
  });
}

// ───────────────────────── vouchers
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = (n = 6) => Array.from({ length: n }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
export async function issueVouchers(c: Caller, i: z.output<typeof IssueVouchersInput>) {
  requireRoles(c, 'buyer', 'cfo');
  const s = must((await col('voucherSeries').doc(i.seriesId).get()).data() as Doc | undefined, `Unknown voucher series ${i.seriesId}`);
  const codes: string[] = [];
  while (codes.length < i.count) {
    const batch = db.batch(); let n = 0;
    for (; n < Math.min(250, i.count - codes.length); n++) {
      const code = `${s.prefix ?? 'VCH'}-${randomCode()}`;
      batch.create(col('vouchers').doc(code), { code, seriesId: i.seriesId, valuePaise: s.valuePaise ?? null, percentOff: s.percentOff ?? null, minSpendPaise: s.minSpendPaise ?? 0, usage: s.usage ?? 'single', perCustomerLimit: s.perCustomerLimit ?? null, validFrom: s.validFrom ?? null, validTo: s.validTo ?? null, channel: s.channel ?? 'All', status: 'active', redemptionCount: 0, customerId: i.customerId ?? null, createdAt: FieldValue.serverTimestamp() });
      codes.push(code);
    }
    try { await batch.commit(); } catch { codes.splice(codes.length - n, n); } // code collision → retry the chunk
  }
  const b = db.batch(); audit(b, c, { action: 'issue_vouchers', entity: 'vouchers', entityId: i.seriesId, before: null, after: { count: i.count } }); await b.commit();
  return { count: codes.length, codes: codes.slice(0, 20) };
}

// ───────────────────────── reserve in store
export async function reserveItems(c: Caller, i: z.output<typeof ReserveItemsInput>) {
  requireRoles(c, 'cashier', 'store_manager', 'sales_associate'); requireLocation(c, i.storeId);
  const skus = await Promise.all(i.lines.map((l) => col('skus').doc(l.skuId).get()));
  const ref = col('reservations').doc();
  return db.runTransaction(async (tx) => {
    const eng = await StockEngine.load(tx, i.lines.map((l) => [i.storeId, l.skuId] as [string, string]), { ignoreLock: true });
    for (const l of i.lines) {
      const d = eng.get(i.storeId, l.skuId);
      if (d.onHand - (d.reserved ?? 0) < l.qty) fail(`Only ${Math.max(0, d.onHand - (d.reserved ?? 0))} available to reserve for ${l.skuId}`);
      eng.move({ locationId: i.storeId, skuId: l.skuId, bucket: 'reserved', qty: l.qty, kind: 'move', refType: 'reservation', refId: ref.id, reason: `Reserved for ${i.customerName}` });
    }
    const num = await reserveNumber(tx, 'RSV', i.storeId); num.write(); eng.commit(tx, c);
    const expiresAt = Timestamp.fromMillis(Date.now() + i.holdHours * 3600_000);
    tx.set(ref, { number: num.number, storeId: i.storeId, customerName: i.customerName, mobile: i.mobile ?? null, status: 'active', expiresAt, lines: i.lines.map((l, k) => ({ skuId: l.skuId, qty: l.qty, name: skus[k]!.get('name') ?? l.skuId })), createdBy: c.uid, createdByName: c.name, createdAt: FieldValue.serverTimestamp() });
    audit(tx, c, { action: 'reserve_items', entity: 'reservations', entityId: ref.id, before: null, after: { number: num.number, lines: i.lines } });
    return { id: ref.id, number: num.number, expiresAt: expiresAt.toDate().toISOString() };
  });
}
export async function releaseReservation(c: Caller, i: z.output<typeof ReleaseReservationInput>) {
  requireRoles(c, 'cashier', 'store_manager', 'sales_associate');
  const ref = col('reservations').doc(i.reservationId);
  return db.runTransaction(async (tx) => {
    const r = must((await tx.get(ref)).data() as Doc | undefined, 'Reservation not found');
    requireLocation(c, r.storeId);
    if (r.status !== 'active') fail(`Reservation is already ${r.status}`);
    const eng = await StockEngine.load(tx, (r.lines as Doc[]).map((l) => [r.storeId, l.skuId] as [string, string]), { ignoreLock: true });
    for (const l of r.lines as Doc[]) eng.move({ locationId: r.storeId, skuId: l.skuId, bucket: 'reserved', qty: -Math.min(l.qty, eng.get(r.storeId, l.skuId).reserved), kind: 'move', refType: 'reservation', refId: ref.id, reason: `Reservation ${i.reason}` });
    eng.commit(tx, c);
    tx.update(ref, { status: i.reason, releasedAt: FieldValue.serverTimestamp() });
    audit(tx, c, { action: 'release_reservation', entity: 'reservations', entityId: ref.id, before: { status: 'active' }, after: { status: i.reason } });
    return { id: ref.id, status: i.reason };
  });
}

// ───────────────────────── e-bill
export async function sendEBill(c: Caller, i: z.output<typeof SendEBillInput>) {
  requireRoles(c, 'cashier', 'store_manager', 'sales_associate');
  const s = must((await col('sales').doc(i.saleId).get()).data() as Doc | undefined, 'Sale not found');
  requireLocation(c, s.storeId);
  const mobile = i.mobile ?? s.customer?.mobile;
  if (!mobile) fail('No mobile number for this bill');
  return sendEBillFor(plain<Doc>({ ...s, id: i.saleId }), mobile, s.customer?.name, s.pointsEarned);
}

// ───────────────────────── customers
export async function createCustomer(c: Caller, i: z.output<typeof CreateCustomerInput>) {
  requireRoles(c, 'cashier', 'store_manager', 'sales_associate');
  const shape = (id: string, d: Doc, created: boolean) => ({ id, code: id, name: d.name, mobile: d.mobile, tierId: d.tierId ?? 'CUTIE', pointsBalance: d.pointsBalance ?? 0, whatsappOptIn: !!d.whatsappOptIn, birthday: d.birthday ?? null, created });
  const ex = await col('customers').where('mobile', '==', i.mobile).limit(1).get();
  if (!ex.empty) return shape(ex.docs[0]!.id, ex.docs[0]!.data(), false);
  const def = MASTER_MAP.customers!;
  return db.runTransaction(async (tx) => {
    const cRef = col('counters').doc('customer_seq');
    const dup = await tx.get(col('customers').where('mobile', '==', i.mobile).limit(1));
    if (!dup.empty) return shape(dup.docs[0]!.id, dup.docs[0]!.data(), false);
    const snap = await tx.get(cRef);
    let seq = ((snap.get('seq') as number | undefined) ?? 2000) + 1;
    let code = `C-${String(seq).padStart(5, '0')}`;
    while ((await tx.get(col('customers').doc(code))).exists) { seq++; code = `C-${String(seq).padStart(5, '0')}`; }
    const data = { code, name: i.name.trim(), mobile: i.mobile, birthday: i.birthday ?? null, tierId: 'CUTIE', pointsBalance: 0, lifetimeSpendPaise: 0, whatsappOptIn: i.whatsappOptIn, status: 'active' };
    const ref = col('customers').doc(code);
    tx.set(cRef, { seq, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(ref, { ...data, version: 1, searchKeywords: searchKeywordsFor(def, data), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdBy: c.uid, updatedBy: c.uid });
    tx.set(ref.collection('versions').doc('00001'), { version: 1, data, kind: 'create', changedBy: c.uid, changedAt: FieldValue.serverTimestamp(), approvedBy: 'pos-walk-in' });
    audit(tx, c, { action: 'create_customer', entity: 'customers', entityId: code, before: null, after: { name: data.name, mobile: data.mobile } });
    return shape(code, data, true);
  });
}

// ───────────────────────── visual search (Claude vision, deterministic fallback)
export async function visualSearch(c: Caller, i: z.output<typeof VisualSearchInput>) {
  requireRoles(c, 'cashier', 'store_manager', 'sales_associate'); requireLocation(c, i.storeId);
  const all = (await col('skus').limit(400).get()).docs.map((d) => ({ id: d.id, ...(d.data() as Doc) }) as Doc).filter((s) => !s.isService && s.status !== 'inactive');
  const cands = all.sort((a, b) => Number(!!b.badges?.includes('Bestseller')) - Number(!!a.badges?.includes('Bestseller')) || a.id.localeCompare(b.id)).slice(0, 80);
  const fallback = () => ({ usedClaude: false, matches: cands.filter((s) => s.badges?.length).concat(cands).filter((s, k, a) => a.findIndex((x) => x.id === s.id) === k).slice(0, 6).map((s) => ({ skuId: s.id, name: s.name, reason: 'Demo fallback — set ANTHROPIC_API_KEY' })) });
  const claude = getClaude(); if (!claude) return fallback();
  try {
    const res = await claude.messages.create({
      model: CLAUDE_MODEL, max_tokens: 600,
      system: 'You match a photo of a retail product to the closest items in a catalogue. Reply with JSON only: [{"skuId": "...", "reason": "..."}] — at most 6 items, best first, skuId must come from the list.',
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: i.mimeType, data: i.imageBase64 } }, { type: 'text', text: `Catalogue:\n${cands.map((s) => `${s.id} | ${s.name} | ${s.colour ?? ''}`).join('\n')}` }] }],
    });
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    const parsed = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)) as { skuId: string; reason: string }[];
    const byId = new Map(cands.map((s) => [s.id, s]));
    const matches = parsed.filter((m) => byId.has(m.skuId)).slice(0, 6).map((m) => ({ skuId: m.skuId, name: byId.get(m.skuId)!.name, reason: m.reason }));
    return matches.length ? { usedClaude: true, matches } : fallback();
  } catch (e) { console.warn('visualSearch fell back', e); if (e instanceof HttpsError) throw e; return fallback(); }
}
