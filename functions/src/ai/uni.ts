import type Anthropic from '@anthropic-ai/sdk';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Query } from '@google-cloud/firestore';
import { z } from 'zod';
import { canSeeStore, CreatePRInput, IssueVouchersInput, type Claims, type UniCard } from '@texafashions/types';
import { Timestamp, col, type Caller } from '../admin';
import { requireLocation, requireRoles, ymd } from '../engine';
import { storePnlReport } from '../finance/reports';

type Doc = Record<string, any>;

export interface ToolResult { card: UniCard; forModel: unknown }

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const ISTART = (day: string) => Timestamp.fromDate(new Date(`${day}T00:00:00+05:30`));
const IEND = (day: string) => Timestamp.fromDate(new Date(new Date(`${day}T00:00:00+05:30`).getTime() + 86_400_000));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-\d{2}$/);

/** Store ids the caller may read: explicit store (checked) or everything their claims allow. */
async function scopedStores(c: Caller, storeId?: string | null): Promise<string[]> {
  if (storeId) { requireLocation(c, storeId); return [storeId]; }
  if (c.claims.role !== 'store_manager' && c.claims.role !== 'cashier' && c.claims.role !== 'sales_associate') {
    return (await col('stores').get()).docs.map((d) => d.id);
  }
  return c.claims.storeIds;
}

async function findSku(q: string): Promise<{ id: string; name: string; code: string } | null> {
  const direct = await col('skus').doc(q).get();
  if (direct.exists) return { id: direct.id, name: String(direct.get('name')), code: String(direct.get('code') ?? direct.id) };
  const hit = (await col('skus').where('searchKeywords', 'array-contains', q.trim().toLowerCase()).limit(1).get()).docs[0];
  return hit ? { id: hit.id, name: String(hit.get('name')), code: String(hit.get('code') ?? hit.id) } : null;
}
const skuNames = async (ids: string[]) => {
  const snaps = ids.length ? await Promise.all(ids.map((i) => col('skus').doc(i).get())) : [];
  return new Map(snaps.map((s) => [s.id, String(s.get('name') ?? s.id)]));
};

// ───────────────────────── read tools
const GetSales = z.object({ storeId: z.string().nullish(), from: day, to: day });
async function getSales(c: Caller, i: z.output<typeof GetSales>): Promise<ToolResult> {
  requireRoles(c, 'cfo', 'buyer', 'warehouse_manager', 'auditor', 'store_manager', 'cashier', 'sales_associate');
  const stores = await scopedStores(c, i.storeId);
  const perDay = new Map<string, number>(); const perStore = new Map<string, number>(); let bills = 0;
  for (const s of stores) {
    const snap = await col('sales').where('storeId', '==', s).where('createdAt', '>=', ISTART(i.from)).where('createdAt', '<', IEND(i.to)).get();
    snap.docs.forEach((d) => {
      if (d.get('status') === 'voided') return;
      const p = (d.get('payablePaise') as number) ?? 0; const dk = ymd((d.get('createdAt') as Timestamp).toDate());
      perDay.set(dk, (perDay.get(dk) ?? 0) + p); perStore.set(s, (perStore.get(s) ?? 0) + p); bills++;
    });
  }
  const total = [...perDay.values()].reduce((a, b) => a + b, 0);
  const points = [...perDay.entries()].sort().map(([label, value]) => ({ label: label.slice(5), value }));
  return {
    card: { kind: 'chart', title: `Sales ${i.from} → ${i.to} · ${inr(total)} · ${bills} bills`, unit: 'paise', points, source: { label: 'POS sales', href: '/dashboard' } },
    forModel: { totalPaise: total, totalFormatted: inr(total), bills, byStore: Object.fromEntries(perStore), byDay: Object.fromEntries(perDay) },
  };
}

const GetStock = z.object({ sku: z.string().nullish(), storeId: z.string().nullish() }).refine((v) => v.sku || v.storeId, 'Give a sku or a storeId');
async function getStock(c: Caller, i: z.output<typeof GetStock>): Promise<ToolResult> {
  requireRoles(c, 'buyer', 'cfo', 'warehouse_manager', 'auditor', 'store_manager', 'cashier', 'sales_associate');
  let q = col('stock').limit(40) as Query;
  let label = '';
  if (i.sku) { const s = await findSku(i.sku); if (!s) return { card: { kind: 'note', text: `No SKU matches “${i.sku}”.` }, forModel: { error: 'sku not found' } }; q = q.where('skuId', '==', s.id); label = s.name; }
  if (i.storeId) { requireLocation(c, i.storeId); q = q.where('locationId', '==', i.storeId); label ||= i.storeId; }
  const docs = (await q.get()).docs.map((d) => d.data() as Doc).filter((d) => canSeeStore(c.claims as Claims, d.locationId));
  const names = await skuNames([...new Set(docs.map((d) => d.skuId as string))]);
  const rows = docs.map((d) => [names.get(d.skuId) ?? d.skuId, d.locationId, d.onHand ?? 0, d.reserved ?? 0, d.inTransit ?? 0]);
  return {
    card: { kind: 'table', title: `Stock · ${label}`, columns: ['SKU', 'Location', 'On hand', 'Reserved', 'In transit'], rows, source: { label: 'Inventory', href: '/inventory' } },
    forModel: { rows: rows.map((r) => ({ sku: r[0], location: r[1], onHand: r[2], reserved: r[3], inTransit: r[4] })) },
  };
}

const GetLowStock = z.object({ storeId: z.string(), threshold: z.number().int().min(0).max(50).nullish() });
async function getLowStock(c: Caller, i: z.output<typeof GetLowStock>): Promise<ToolResult> {
  requireRoles(c, 'buyer', 'cfo', 'warehouse_manager', 'auditor', 'store_manager');
  requireLocation(c, i.storeId);
  const th = i.threshold ?? 5;
  const docs = (await col('stock').where('locationId', '==', i.storeId).where('onHand', '<=', th).orderBy('onHand').limit(15).get()).docs.map((d) => d.data() as Doc);
  const names = await skuNames(docs.map((d) => d.skuId));
  const rows = docs.map((d) => [names.get(d.skuId) ?? d.skuId, d.onHand ?? 0]);
  return {
    card: { kind: 'table', title: `Low stock at ${i.storeId} (≤ ${th})`, columns: ['SKU', 'On hand'], rows, source: { label: 'Replenishment', href: '/inventory' } },
    forModel: { threshold: th, items: docs.map((d) => ({ skuId: d.skuId, name: names.get(d.skuId), onHand: d.onHand })) },
  };
}

async function getOpenPOs(c: Caller): Promise<ToolResult> {
  requireRoles(c, 'buyer', 'cfo', 'warehouse_manager', 'auditor');
  const docs = (await col('purchaseOrders').where('status', 'in', ['pending_approval', 'approved', 'sent', 'acknowledged', 'partially_received']).limit(25).get()).docs;
  const rows = docs.map((d) => [d.get('number'), d.get('vendorName'), String(d.get('status')).replace(/_/g, ' '), inr(d.get('totalInrPaise') ?? 0)]);
  return {
    card: { kind: 'table', title: `${rows.length} open purchase orders`, columns: ['PO', 'Vendor', 'Status', 'Value'], rows: rows as (string | number)[][], source: { label: 'Purchase orders', href: '/scm' } },
    forModel: { count: rows.length, pos: docs.map((d) => ({ number: d.get('number'), vendor: d.get('vendorName'), status: d.get('status'), totalPaise: d.get('totalInrPaise') })) },
  };
}

const GetCashVariance = z.object({ date: day });
async function getCashVariance(c: Caller, i: z.output<typeof GetCashVariance>): Promise<ToolResult> {
  requireRoles(c, 'cfo', 'auditor', 'store_manager');
  const stores = new Set(await scopedStores(c));
  const docs = (await col('zReports').where('closedAt', '>=', ISTART(i.date)).where('closedAt', '<', IEND(i.date)).get()).docs.map((d) => d.data() as Doc).filter((z) => stores.has(z.storeId));
  const rows = docs.map((z) => [z.storeId, z.shiftNo ?? z.shiftId, z.cashierName, inr(z.variancePaise ?? 0)]);
  const net = docs.reduce((a, z) => a + (z.variancePaise ?? 0), 0);
  return {
    card: { kind: 'table', title: `Cash variance ${i.date} · net ${inr(net)}`, columns: ['Store', 'Shift', 'Cashier', 'Variance'], rows: rows as (string | number)[][], source: { label: 'Z-reports', href: '/dashboard' } },
    forModel: { date: i.date, netVariancePaise: net, shifts: docs.map((z) => ({ store: z.storeId, shift: z.shiftNo, cashier: z.cashierName, variancePaise: z.variancePaise })) },
  };
}

const GetPnL = z.object({ storeId: z.string().nullish(), month: month.nullish() });
async function getPnL(c: Caller, i: z.output<typeof GetPnL>): Promise<ToolResult> {
  if (i.storeId) requireLocation(c, i.storeId);
  const r = await storePnlReport(c, { period: i.month ?? null }); // re-checks finance roles
  const rows = r.rows.filter((x) => (i.storeId ? x.storeId === i.storeId : canSeeStore(c.claims as Claims, x.storeId)));
  return {
    card: { kind: 'table', title: `P&L · ${r.period}`, columns: ['Store', 'Revenue', 'COGS', 'Gross profit', 'GM %'], rows: rows.map((x) => [x.storeName, inr(x.revenuePaise), inr(x.cogsPaise), inr(x.grossProfitPaise), `${x.grossMarginPct}%`]), source: { label: 'Finance', href: '/finance' } },
    forModel: { period: r.period, stores: rows },
  };
}

// ───────────────────────── write tools — return a confirmation card only
const BUYING = ['buyer', 'store_manager', 'warehouse_manager', 'cfo'] as const;
const ProposePR = z.object({ storeId: z.string(), lines: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })).min(1).max(10), notes: z.string().nullish() });
async function createPurchaseRequisition(c: Caller, i: z.output<typeof ProposePR>): Promise<ToolResult> {
  requireRoles(c, ...BUYING); requireLocation(c, i.storeId);
  const lines: { skuId: string; qty: number }[] = []; const summary: string[] = [];
  for (const l of i.lines) {
    const s = await findSku(l.sku);
    if (!s) return { card: { kind: 'note', text: `I couldn’t find SKU “${l.sku}”.` }, forModel: { error: `sku ${l.sku} not found` } };
    lines.push({ skuId: s.id, qty: l.qty }); summary.push(`${l.qty} × ${s.name}`);
  }
  const input = CreatePRInput.parse({ storeId: i.storeId, lines, notes: i.notes ?? 'Raised via Uni' });
  return {
    card: { kind: 'confirm', title: `Create purchase requisition for ${i.storeId}`, summary, command: 'createPR', input },
    forModel: { status: 'awaiting_user_confirmation', note: 'Nothing has been created. Tell the user to review the card and tap Confirm.' },
  };
}

const ProposeVoucher = z.object({ seriesId: z.string(), count: z.number().int().min(1).max(500) });
async function createVoucher(c: Caller, i: z.output<typeof ProposeVoucher>): Promise<ToolResult> {
  requireRoles(c, 'buyer', 'cfo');
  const s = (await col('voucherSeries').doc(i.seriesId).get());
  if (!s.exists) return { card: { kind: 'note', text: `Unknown voucher series “${i.seriesId}”.` }, forModel: { error: 'series not found' } };
  const input = IssueVouchersInput.parse({ seriesId: i.seriesId, count: i.count });
  return {
    card: { kind: 'confirm', title: `Issue ${i.count} voucher${i.count > 1 ? 's' : ''}`, summary: [`Series: ${s.get('name') ?? i.seriesId}`, `Count: ${i.count}`], command: 'issueVouchers', input },
    forModel: { status: 'awaiting_user_confirmation', note: 'Nothing has been issued. Tell the user to review the card and tap Confirm.' },
  };
}

// ───────────────────────── registry
const TOOLS = {
  getSales: { schema: GetSales, run: getSales, description: 'Sales totals (INR) per day/store for a date range (YYYY-MM-DD, IST). Omit storeId for all stores the user can see.' },
  getStock: { schema: GetStock, run: getStock, description: 'Stock on hand by SKU (code/name/id) and/or store/warehouse id.' },
  getLowStock: { schema: GetLowStock, run: getLowStock, description: 'Items at or below a threshold (default 5) at one store.' },
  getOpenPOs: { schema: z.object({}), run: getOpenPOs, description: 'Open (not yet fully received) purchase orders.' },
  getCashVariance: { schema: GetCashVariance, run: getCashVariance, description: 'Till cash variance from Z-reports for a date.' },
  getPnL: { schema: GetPnL, run: getPnL, description: 'Store P&L (revenue, COGS, gross margin) for a month YYYY-MM.' },
  createPurchaseRequisition: { schema: ProposePR, run: createPurchaseRequisition, description: 'PROPOSE a purchase requisition. Returns a confirmation card; the user must tap Confirm before anything is created.' },
  createVoucher: { schema: ProposeVoucher, run: createVoucher, description: 'PROPOSE issuing vouchers from a voucher series (e.g. VS-WELCOME). Returns a confirmation card; the user must tap Confirm.' },
} as const;
export type ToolName = keyof typeof TOOLS;

export const TOOL_DEFS: Anthropic.Tool[] = (Object.entries(TOOLS) as [ToolName, (typeof TOOLS)[ToolName]][]).map(([name, t]) => ({
  name, description: t.description, input_schema: z.toJSONSchema(t.schema as z.ZodType) as Anthropic.Tool.InputSchema,
}));

/** Every tool re-checks the caller's custom claims (role + store scope) itself — the model never gets data the user could not open. */
export async function runTool(c: Caller, name: string, raw: unknown): Promise<ToolResult> {
  const t = TOOLS[name as ToolName];
  if (!t) return { card: { kind: 'note', text: `Unknown tool ${name}` }, forModel: { error: 'unknown tool' } };
  const parsed = (t.schema as z.ZodType).safeParse(raw ?? {});
  if (!parsed.success) return { card: { kind: 'note', text: 'I need a bit more detail for that.' }, forModel: { error: parsed.error.issues.map((x) => x.message).join('; ') } };
  try { return await (t.run as (c: Caller, i: unknown) => Promise<ToolResult>)(c, parsed.data); }
  catch (e) {
    if (e instanceof HttpsError) return { card: { kind: 'note', text: `🔒 ${e.message}` }, forModel: { error: e.message, code: e.code } };
    throw e;
  }
}

export const systemPrompt = (c: Caller, today: string) =>
  `You are Uni, the friendly AI teammate inside Texa Fashions OS (lifestyle retail, India; 8 mall stores + web). Today is ${today} (IST).
The user is ${c.name}, role ${c.claims.role}, stores: ${c.claims.storeIds.join(', ') || 'all'}.
Use tools for any numbers — never invent data. Money from tools is in paise; quote it in ₹. Keep answers short (2–4 sentences); tool results are shown to the user as cards, so don't repeat tables.
For writes call the propose tools (createPurchaseRequisition, createVoucher): they only show a confirmation card, so say "please review and tap Confirm". If a tool says access is denied, explain politely.`;
