/** Phase 7 — alerts + insights: gathers a snapshot, runs the pure rules in `@texafashions/domain`, writes `/aiInsights` and fans out to each user's `/inbox`. */
import { HttpsError } from 'firebase-functions/v2/https';
import {
  addDay, bySeverity, daysOfCover, evaluateAlerts, forecastByWeekday, forecastMarkdown, forecastReplenishment,
  type AlertCandidate, type AlertSnapshot, type DailyQty,
} from '@texafashions/domain';
import { canSeeStore, DEMO_USERS, type Briefing, type InboxActionInput, type InboxSeverity } from '@texafashions/types';
import { FieldValue, Timestamp, col, db, writeAudit, type Caller } from '../admin';
import { claudeText } from '../claude';
import { requireRoles, ymd } from '../engine';

type Doc = Record<string, any>;
const ISTART = (day: string) => Timestamp.fromDate(new Date(`${day}T00:00:00+05:30`));
const OPEN_PO = ['approved', 'sent', 'acknowledged', 'partially_received'];
const STAFF_ROLES = ['buyer', 'cfo', 'warehouse_manager', 'store_manager', 'auditor'] as const;
const OPS = ['buyer', 'warehouse_manager', 'cfo', 'auditor', 'store_manager'];

async function gather(now: Date): Promise<{ snap: AlertSnapshot; extra: AlertCandidate[] }> {
  const day = ymd(now); const hourIst = new Date(now.getTime() + 5.5 * 3600_000).getUTCHours();
  const [stores, sales, stock, pos, grns, zs, tally, skus] = await Promise.all([
    col('stores').get(), col('sales').where('createdAt', '>=', ISTART(addDay(day, -28))).get(), col('stock').get(),
    col('purchaseOrders').where('status', 'in', OPEN_PO).get(), col('grns').where('hasVariance', '==', true).limit(30).get(),
    col('zReports').where('closedAt', '>=', ISTART(addDay(day, -1))).get(), col('tallyQueue').where('status', '==', 'failed').limit(20).get(), col('skus').get(),
  ]);
  const storeName = new Map(stores.docs.map((d) => [d.id, String(d.get('name') ?? d.id)]));
  const skuName = new Map(skus.docs.map((d) => [d.id, String(d.get('name') ?? d.id)]));

  // ── sales → per store × sku daily units, per store daily revenue / voids, voucher use per till
  const units = new Map<string, Map<string, number>>();   // `${store}_${sku}` → day → qty
  const rev = new Map<string, Map<string, number>>(); const bills = new Map<string, Map<string, number>>(); const voids = new Map<string, Map<string, number>>();
  const bump = (m: Map<string, Map<string, number>>, k: string, d: string, n: number) => { const x = m.get(k) ?? new Map<string, number>(); x.set(d, (x.get(d) ?? 0) + n); m.set(k, x); };
  const voucherUse = new Map<string, number>();
  for (const s of sales.docs.map((d) => d.data() as Doc)) {
    const d = ymd((s.createdAt as Timestamp).toDate());
    bump(bills, s.storeId, d, 1);
    if (s.status === 'voided') { bump(voids, s.storeId, d, 1); continue; }
    bump(rev, s.storeId, d, s.payablePaise ?? 0);
    for (const l of (s.lines ?? []) as Doc[]) if (!l.isService) bump(units, `${s.storeId}_${l.skuId}`, d, l.qty ?? 0);
    if (d === day && s.voucherCode) { const k = `${s.storeId}|${s.tillId}`; voucherUse.set(k, (voucherUse.get(k) ?? 0) + 1); }
  }
  const sum = (m?: Map<string, number>, from?: string, to?: string) => [...(m ?? [])].filter(([d]) => (!from || d >= from) && (!to || d < to)).reduce((a, [, v]) => a + v, 0);

  // ── forecast per stocked store × sku that has demand history
  const stockCover: AlertSnapshot['stockCover'] = []; const extra: AlertCandidate[] = [];
  const repl: { c: AlertCandidate; qty: number }[] = []; const mark: { c: AlertCandidate; weeks: number }[] = [];
  for (const st of stock.docs.map((d) => d.data() as Doc)) {
    const hist = units.get(`${st.locationId}_${st.skuId}`); if (!hist) continue;
    const history: DailyQty[] = [...hist].map(([d, qty]) => ({ day: d, qty }));
    const f = forecastByWeekday(history, day, 28); const cover = daysOfCover(st.onHand ?? 0, f);
    const name = skuName.get(st.skuId) ?? st.skuId;
    stockCover.push({ skuId: st.skuId, skuName: name, locationId: st.locationId, onHand: st.onHand ?? 0, daysOfCover: cover });
    const r = forecastReplenishment({ onHand: st.onHand ?? 0, onOrder: st.onOrder ?? 0, inTransit: st.inTransit ?? 0, forecast: f, leadTimeDays: 4 });
    if (r.suggestQty > 0 && cover >= 3 && cover < 10)
      repl.push({ qty: r.suggestQty, c: { ruleId: 'replenishment', severity: 'info', storeId: st.locationId, dedupeKey: `replenishment_${st.locationId}_${st.skuId}_${day}`, audience: OPS, link: '/inventory',
        title: `Reorder ${r.suggestQty} × ${name} for ${st.locationId}`, detail: r.reason, data: { skuId: st.skuId, suggestion: { kind: 'replenish', qty: r.suggestQty } } } });
    const m = forecastMarkdown({ onHand: st.onHand ?? 0, forecast: f });
    if (m) mark.push({ weeks: m.weeksOfCover, c: { ruleId: 'markdown', severity: 'info', storeId: st.locationId, dedupeKey: `markdown_${st.locationId}_${st.skuId}_${day}`, audience: ['buyer', 'cfo', 'auditor', 'store_manager'], link: '/master/promotions',
      title: `Mark down ${name} by ${m.markdownPct}% at ${st.locationId}`, detail: m.reason, data: { skuId: st.skuId, suggestion: { kind: 'markdown', markdownPct: m.markdownPct } } } });
  }
  extra.push(...repl.sort((a, b) => b.qty - a.qty).slice(0, 5).map((x) => x.c), ...mark.sort((a, b) => b.weeks - a.weeks).slice(0, 5).map((x) => x.c));
  stockCover.sort((a, b) => a.daysOfCover - b.daysOfCover);

  const prior = (m: Map<string, Map<string, number>>, s: string) => sum(m.get(s), addDay(day, -14), day);
  const snap: AlertSnapshot = {
    day, hourIst,
    stockCover: stockCover.slice(0, 8),
    overduePOs: pos.docs.map((d) => ({ id: d.id, number: String(d.get('number')), vendorName: String(d.get('vendorName') ?? ''), expectedDate: String(d.get('expectedDate') ?? '') }))
      .filter((p) => p.expectedDate && p.expectedDate < day).map((p) => ({ ...p, daysLate: Math.round((new Date(day).getTime() - new Date(p.expectedDate).getTime()) / 86_400_000) })),
    varianceGrns: grns.docs.map((d) => ({ g: d.data() as Doc, id: d.id }))
      .filter(({ g }) => g.createdAt && ymd((g.createdAt as Timestamp).toDate()) >= addDay(day, -7))
      .map(({ g, id }) => ({ id, number: String(g.number), poNumber: String(g.poNumber), locationId: String(g.locationId),
        short: (g.lines as Doc[]).reduce((a, l) => a + (l.shortQty ?? 0), 0), excess: (g.lines as Doc[]).reduce((a, l) => a + (l.excessQty ?? 0), 0), damaged: (g.lines as Doc[]).reduce((a, l) => a + (l.damagedQty ?? 0), 0) })),
    zReports: zs.docs.map((d) => d.data() as Doc).map((z) => ({ shiftId: String(z.shiftId), storeId: String(z.storeId), shiftNo: z.shiftNo ?? z.shiftId, cashierName: String(z.cashierName ?? ''), variancePaise: z.variancePaise ?? 0 })),
    voidStats: [...bills.keys()].map((s) => {
      const pb = prior(bills, s); return { storeId: s, todayVoids: voids.get(s)?.get(day) ?? 0, todayBills: bills.get(s)?.get(day) ?? 0, baselineRate: pb ? prior(voids, s) / pb : 0 };
    }),
    voucherUse: [...voucherUse].map(([k, count]) => { const [storeId, tillId] = k.split('|'); return { storeId: storeId!, tillId: tillId!, count }; }),
    failedTally: tally.docs.map((d) => ({ id: d.id, storeId: (d.get('storeId') as string) ?? null, day: (d.get('day') as string) ?? null, attempts: d.get('attempts') ?? 0, error: String(d.get('lastError') ?? '') })),
    // Target = average completed-sales day over the previous 14 days that traded (needs ≥ 3 days of history).
    salesToday: [...rev.keys()].flatMap((s) => {
      const days = [...(rev.get(s) ?? [])].filter(([d]) => d >= addDay(day, -14) && d < day);
      return days.length >= 3 ? [{ storeId: s, storeName: storeName.get(s) ?? s, salesPaise: rev.get(s)?.get(day) ?? 0, targetPaise: Math.round(days.reduce((a, [, v]) => a + v, 0) / days.length) }] : [];
    }),
  };
  return { snap, extra };
}

/** Roles' storeIds aren't known for real users in the demo — fan out to the seeded demo accounts that may see the alert. */
export const recipients = (c: AlertCandidate) => DEMO_USERS.filter((u) => u.role !== 'vendor'
  && (u.role === 'super_admin' || c.audience.includes(u.role))
  && (!c.storeId || canSeeStore({ role: u.role, storeIds: u.storeIds, approvalLimitPaise: u.approvalLimitPaise }, c.storeId)));

export async function runAlerts(now = new Date()): Promise<{ evaluated: number; created: number }> {
  const { snap, extra } = await gather(now);
  const cands = [...evaluateAlerts(snap), ...extra];
  const refs = cands.map((c) => col('aiInsights').doc(c.dedupeKey));
  const existing = refs.length ? await db.getAll(...refs) : [];
  const fresh = cands.filter((_, i) => !existing[i]!.exists);
  let batch = db.batch(); let n = 0;
  const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
  for (const c of fresh) {
    const base = { ruleId: c.ruleId, severity: c.severity, storeId: c.storeId, title: c.title, detail: c.detail, link: c.link ?? null, suggestion: (c.data?.suggestion as unknown) ?? null };
    batch.set(col('aiInsights').doc(c.dedupeKey), { ...base, audience: c.audience, day: snap.day, status: 'open', source: c.ruleId === 'replenishment' || c.ruleId === 'markdown' ? 'forecast' : 'rule', data: c.data ?? null, createdAt: FieldValue.serverTimestamp() }); n++;
    for (const u of recipients(c)) {
      batch.set(col('inbox').doc(`${u.uid}_${c.dedupeKey}`), { ...base, userId: u.uid, insightId: c.dedupeKey, status: 'new', assignedTo: null, snoozedUntil: null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }); n++;
    }
    if (n > 400) await flush();
  }
  await flush();
  return { evaluated: cands.length, created: fresh.length };
}

export async function runAlertsNow(c: Caller) { requireRoles(c, ...STAFF_ROLES); return runAlerts(); }

// ───────────────────────── inbox actions
export async function inboxAction(c: Caller, i: InboxActionInput) {
  const ref = col('inbox').doc(i.id); const snap = await ref.get();
  if (!snap.exists || snap.get('userId') !== c.uid) throw new HttpsError('permission-denied', 'Not your notification');
  const row = snap.data() as Doc; const b = db.batch(); const stamp = FieldValue.serverTimestamp();
  const audit = (after: unknown) => writeAudit(b, c, { action: `inbox_${i.action}`, entity: 'inbox', entityId: i.id, before: { status: row.status, assignedTo: row.assignedTo ?? null }, after });
  switch (i.action) {
    case 'read': if (row.status === 'new') b.update(ref, { status: 'read', updatedAt: stamp }); break;
    case 'snooze': {
      const until = Timestamp.fromMillis(Date.now() + (i.snoozeHours ?? 4) * 3600_000);
      b.update(ref, { status: 'snoozed', snoozedUntil: until, updatedAt: stamp }); audit({ status: 'snoozed', hours: i.snoozeHours ?? 4 }); break;
    }
    case 'resolve': {
      const all = await col('inbox').where('insightId', '==', row.insightId).get();
      all.docs.forEach((d) => b.update(d.ref, { status: 'resolved', updatedAt: stamp }));
      b.update(col('aiInsights').doc(row.insightId), { status: 'resolved', resolvedBy: c.uid, resolvedAt: stamp }); audit({ status: 'resolved' }); break;
    }
    case 'reopen': b.update(ref, { status: 'read', snoozedUntil: null, updatedAt: stamp }); audit({ status: 'read' }); break;
    case 'assign': {
      const to = DEMO_USERS.find((u) => u.uid === i.assignTo && u.role !== 'vendor');
      if (!to) throw new HttpsError('invalid-argument', 'Pick a teammate to assign to');
      b.update(ref, { status: 'read', assignedTo: to.uid, assignedToName: to.displayName, updatedAt: stamp });
      if (to.uid !== c.uid) {
        const { id: _id, ...rest } = row;
        b.set(col('inbox').doc(`${to.uid}_${row.insightId}`), { ...rest, userId: to.uid, status: 'new', assignedTo: to.uid, assignedToName: to.displayName, assignedBy: c.name, snoozedUntil: null, createdAt: stamp, updatedAt: stamp });
      }
      audit({ assignedTo: to.uid }); break;
    }
  }
  await b.commit();
  return { ok: true };
}

// ───────────────────────── daily briefing (one Claude call, cached per day per visibility scope)
export async function dailyBriefing(c: Caller): Promise<Briefing> {
  requireRoles(c, ...STAFF_ROLES, 'hr_manager', 'sales_associate', 'cashier');
  const day = ymd(); const all = c.claims.storeIds.length === 0;
  const ref = col('aiBriefings').doc(`${day}_${all ? 'ALL' : [...c.claims.storeIds].sort().join('+')}`);
  const hit = await ref.get();
  if (hit.exists) return { ...(hit.data() as Briefing), cached: true };

  const load = async () => (await col('aiInsights').where('day', '==', day).get()).docs.map((d) => d.data() as Doc)
    .filter((x) => x.status === 'open' && (!x.storeId || canSeeStore(c.claims, x.storeId)) && (c.claims.role === 'super_admin' || (x.audience as string[]).includes(c.claims.role)));
  let rows = await load();
  if (!rows.length) { await runAlerts(); rows = await load(); }
  const top = rows.sort((a, b) => bySeverity(a as { severity: InboxSeverity }, b as { severity: InboxSeverity })).slice(0, 5)
    .map((x) => ({ title: String(x.title), detail: String(x.detail), severity: x.severity as InboxSeverity, storeId: (x.storeId as string) ?? null }));

  let text: string | null = null;
  if (top.length) {
    try {
      text = await claudeText('You write Texa Fashions\' daily operations briefing for a retail manager in India. Plain text, max 90 words, warm and direct. Start with the single most urgent item, then one line on the rest, then one suggested first action. No markdown, no bullet symbols.',
        `Today is ${day}. Top insights (most severe first):\n${top.map((t, i) => `${i + 1}. [${t.severity}] ${t.title} — ${t.detail}`).join('\n')}`, 400);
    } catch (e) { console.error('briefing claude failed', e); }
  }
  const out: Briefing = {
    day, source: text ? 'claude' : 'rules', cached: false, top: top.map(({ title, severity, storeId }) => ({ title, severity, storeId })),
    text: text?.trim() || (top.length ? `${top.length} thing${top.length > 1 ? 's' : ''} need attention today. Most urgent: ${top[0]!.title}. ${top[0]!.detail}` : 'All clear — no open alerts or suggestions for today.'),
  };
  await ref.set({ ...out, createdAt: FieldValue.serverTimestamp() });
  return out;
}
