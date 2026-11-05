/** Read-model report callables for the Finance module. All compute on demand from journals/apBills/webOrders — data volumes are small enough in this demo that a materialised rollup isn't needed. */
import type { z } from 'zod';
import { AGE_BUCKETS, ageBucket, type AgeBucket } from '@texafashions/domain';
import type { ApAgeingReportInput, ArAgeingReportInput, BudgetVsActualReportInput, SetBudgetInput, StorePnlReportInput } from '@texafashions/types';
import { FieldValue, col, type Caller } from '../admin';
import { requireRoles } from '../engine';

type Doc = Record<string, any>;
const HQ_FIN = ['cfo', 'super_admin', 'auditor'] as const;
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
const emptyBuckets = () => Object.fromEntries(AGE_BUCKETS.map((b) => [b, { count: 0, amountPaise: 0 }])) as Record<AgeBucket, { count: number; amountPaise: number }>;

// ───────────────────────── AP ageing
export async function apAgeingReport(c: Caller, _i: z.output<typeof ApAgeingReportInput>) {
  requireRoles(c, ...HQ_FIN);
  const bills = await col('apBills').where('status', 'in', ['open', 'partially_paid']).get();
  const buckets = emptyBuckets(); const rows: Doc[] = [];
  bills.docs.forEach((d) => {
    const b = d.data() as Doc; const days = daysSince(b.dueDate); const bucket = ageBucket(days);
    buckets[bucket].count++; buckets[bucket].amountPaise += b.balancePaise;
    rows.push({ id: d.id, vendorId: b.vendorId, vendorName: b.vendorName, invoiceNo: b.invoiceNo, dueDate: b.dueDate, balancePaise: b.balancePaise, daysOverdue: days, bucket, isMsme: !!b.isMsme });
  });
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return { totalPaise: rows.reduce((a, r) => a + r.balancePaise, 0), buckets, rows: rows.slice(0, 300), generatedAt: new Date().toISOString() };
}

// ───────────────────────── AR ageing (B2C demo: no invoiced trade receivables — "AR" is COD cash still with the courier)
export async function arAgeingReport(c: Caller, _i: z.output<typeof ArAgeingReportInput>) {
  requireRoles(c, ...HQ_FIN);
  const orders = await col('webOrders').where('codStatus', 'in', ['awaiting_delivery', 'with_courier']).get();
  const buckets = emptyBuckets(); const rows: Doc[] = [];
  orders.docs.forEach((d) => {
    const o = d.data() as Doc; const days = daysSince(o.createdAt); const bucket = ageBucket(days); const amount = o.payablePaise ?? 0;
    buckets[bucket].count++; buckets[bucket].amountPaise += amount;
    rows.push({ id: d.id, orderName: o.orderName ?? d.id, codStatus: o.codStatus, createdAt: o.createdAt, amountPaise: amount, daysOutstanding: days, bucket });
  });
  rows.sort((a, b) => b.daysOutstanding - a.daysOutstanding);
  return { totalPaise: rows.reduce((a, r) => a + r.amountPaise, 0), buckets, rows: rows.slice(0, 300), generatedAt: new Date().toISOString(), note: 'AR here = COD cash currently with the courier, not yet remitted — this B2C retailer has no invoiced trade receivables.' };
}

// ───────────────────────── Store P&L by cost centre
function monthRange(period?: string | null) {
  const p = period ?? new Date().toISOString().slice(0, 7);
  const [y, m] = p.split('-').map(Number) as [number, number];
  const nextY = m === 12 ? y + 1 : y; const nextM = m === 12 ? 1 : m + 1;
  return { period: p, start: `${p}-01`, end: `${nextY}-${String(nextM).padStart(2, '0')}-01` };
}

async function computeStorePnl(period?: string | null) {
  const { period: p, start, end } = monthRange(period);
  const [js, stores, whs] = await Promise.all([
    col('journals').where('day', '>=', start).where('day', '<', end).get(),
    col('stores').get(), col('warehouses').get(),
  ]);
  const names = new Map<string, string>();
  stores.docs.forEach((d) => names.set(d.id, String(d.get('name'))));
  whs.docs.forEach((d) => names.set(d.id, String(d.get('name'))));
  const byStore = new Map<string, { revenuePaise: number; cogsPaise: number }>();
  js.docs.forEach((d) => {
    const j = d.data() as Doc; const storeId = j.storeId as string | undefined; if (!storeId) return;
    const row = byStore.get(storeId) ?? { revenuePaise: 0, cogsPaise: 0 };
    for (const l of j.lines as Doc[]) {
      if (l.ledgerId === 'L-SALES' || l.ledgerId === 'L-SALES-WEB') row.revenuePaise += l.crPaise - l.drPaise;
      else if (l.ledgerId === 'L-SALES-RET') row.revenuePaise -= l.drPaise - l.crPaise;
      else if (l.ledgerId === 'L-COGS') row.cogsPaise += l.drPaise - l.crPaise;
    }
    byStore.set(storeId, row);
  });
  const rows = [...byStore.entries()]
    .map(([storeId, v]) => ({ id: storeId, storeId, storeName: names.get(storeId) ?? storeId, revenuePaise: v.revenuePaise, cogsPaise: v.cogsPaise, grossProfitPaise: v.revenuePaise - v.cogsPaise, grossMarginPct: v.revenuePaise > 0 ? Math.round(((v.revenuePaise - v.cogsPaise) / v.revenuePaise) * 1000) / 10 : 0 }))
    .sort((a, b) => b.revenuePaise - a.revenuePaise);
  return { period: p, rows, totalRevenuePaise: rows.reduce((a, r) => a + r.revenuePaise, 0), totalCogsPaise: rows.reduce((a, r) => a + r.cogsPaise, 0), generatedAt: new Date().toISOString() };
}

export async function storePnlReport(c: Caller, i: z.output<typeof StorePnlReportInput>) {
  requireRoles(c, ...HQ_FIN, 'store_manager');
  return computeStorePnl(i.period);
}

// ───────────────────────── Budget vs actual
export async function budgetVsActualReport(c: Caller, i: z.output<typeof BudgetVsActualReportInput>) {
  requireRoles(c, ...HQ_FIN);
  const pnl = await computeStorePnl(i.period);
  const budgets = await col('budgets').where('period', '==', pnl.period).get();
  const budgetMap = new Map(budgets.docs.map((d) => [d.get('storeId') as string, d.get('salesBudgetPaise') as number]));
  const rows = pnl.rows.map((r) => {
    const budgetPaise = budgetMap.get(r.storeId) ?? 0; const variancePaise = r.revenuePaise - budgetPaise;
    return { ...r, budgetPaise, variancePaise, variancePct: budgetPaise > 0 ? Math.round((variancePaise / budgetPaise) * 1000) / 10 : null };
  });
  return { period: pnl.period, rows, totalBudgetPaise: rows.reduce((a, r) => a + r.budgetPaise, 0), totalActualPaise: pnl.totalRevenuePaise, generatedAt: new Date().toISOString() };
}

export async function setBudget(c: Caller, i: z.output<typeof SetBudgetInput>) {
  requireRoles(c, 'cfo', 'super_admin');
  const id = `${i.storeId}_${i.period}`;
  await col('budgets').doc(id).set({ storeId: i.storeId, period: i.period, salesBudgetPaise: i.salesBudgetPaise, updatedBy: c.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { id };
}
