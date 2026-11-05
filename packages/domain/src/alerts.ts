/** Alert rules: pure functions over a pre-gathered snapshot. The Cloud Function gathers the snapshot and persists the candidates. */
export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertRuleId =
  | 'stock_out_risk' | 'po_overdue' | 'grn_variance' | 'cash_variance' | 'void_spike' | 'voucher_abuse' | 'tally_sync_failed' | 'sales_behind_target'
  | 'replenishment' | 'markdown';

export const ALERT_THRESHOLDS = {
  stockOutCoverDays: 3,
  voidRateMultiple: 3,
  minVoidsToFlag: 2,
  voucherUsesPerTillPerDay: 5,
  salesTargetFraction: 0.4,
  salesCheckHourIst: 14,
  cashVarianceTolerancePaise: 50_00,
  cashVarianceCriticalPaise: 500_00,
};

export interface AlertCandidate {
  ruleId: AlertRuleId; severity: AlertSeverity; storeId: string | null; title: string; detail: string;
  /** Stable per rule+entity+day so re-running never duplicates. */
  dedupeKey: string;
  /** Roles that should see it (super_admin always does). */
  audience: string[];
  link?: string;
  data?: Record<string, unknown>;
}

export interface AlertSnapshot {
  day: string;               // IST YYYY-MM-DD
  hourIst: number;
  stockCover: { skuId: string; skuName: string; locationId: string; onHand: number; daysOfCover: number }[];
  overduePOs: { id: string; number: string; vendorName: string; expectedDate: string; daysLate: number }[];
  varianceGrns: { id: string; number: string; poNumber: string; locationId: string; short: number; excess: number; damaged: number }[];
  zReports: { shiftId: string; storeId: string; shiftNo: string | number; cashierName: string; variancePaise: number }[];
  voidStats: { storeId: string; todayVoids: number; todayBills: number; baselineRate: number }[];
  voucherUse: { storeId: string; tillId: string; count: number }[];
  failedTally: { id: string; storeId: string | null; day: string | null; attempts: number; error: string }[];
  salesToday: { storeId: string; storeName: string; salesPaise: number; targetPaise: number }[];
}

const inr = (p: number) => `₹${(Math.abs(p) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const OPS = ['buyer', 'warehouse_manager', 'cfo', 'auditor'];
const STORE = ['store_manager', 'cfo', 'auditor'];
const FIN = ['cfo', 'auditor'];

export function evaluateAlerts(s: AlertSnapshot): AlertCandidate[] {
  const T = ALERT_THRESHOLDS; const out: AlertCandidate[] = []; const k = (rule: string, id: string) => `${rule}_${id}_${s.day}`;

  for (const r of s.stockCover) if (r.daysOfCover < T.stockOutCoverDays)
    out.push({ ruleId: 'stock_out_risk', severity: r.onHand === 0 ? 'critical' : 'warning', storeId: r.locationId, dedupeKey: k('stock_out_risk', `${r.locationId}_${r.skuId}`), audience: [...OPS, 'store_manager'], link: '/inventory',
      title: `${r.skuName} may stock out at ${r.locationId}`, detail: `${r.onHand} on hand = ${r.daysOfCover} days of cover (threshold ${T.stockOutCoverDays}).`, data: { skuId: r.skuId } });

  for (const p of s.overduePOs)
    out.push({ ruleId: 'po_overdue', severity: p.daysLate > 7 ? 'critical' : 'warning', storeId: null, dedupeKey: k('po_overdue', p.id), audience: OPS, link: '/scm',
      title: `PO ${p.number} is ${p.daysLate}d overdue`, detail: `${p.vendorName} promised ${p.expectedDate}; nothing fully received yet.`, data: { poId: p.id } });

  for (const g of s.varianceGrns)
    out.push({ ruleId: 'grn_variance', severity: 'warning', storeId: g.locationId, dedupeKey: k('grn_variance', g.id), audience: OPS, link: '/scm',
      title: `GRN ${g.number} has receiving variance`, detail: `Against ${g.poNumber}: short ${g.short}, excess ${g.excess}, damaged ${g.damaged}.`, data: { grnId: g.id } });

  for (const z of s.zReports) if (Math.abs(z.variancePaise) > T.cashVarianceTolerancePaise)
    out.push({ ruleId: 'cash_variance', severity: Math.abs(z.variancePaise) >= T.cashVarianceCriticalPaise ? 'critical' : 'warning', storeId: z.storeId, dedupeKey: k('cash_variance', z.shiftId), audience: STORE,
      title: `Cash ${z.variancePaise < 0 ? 'short' : 'over'} ${inr(z.variancePaise)} at ${z.storeId}`, detail: `Shift ${z.shiftNo} closed by ${z.cashierName} with a ${inr(z.variancePaise)} variance.`, data: { shiftId: z.shiftId } });

  for (const v of s.voidStats) {
    const rate = v.todayBills ? v.todayVoids / v.todayBills : 0;
    if (v.todayVoids >= T.minVoidsToFlag && rate > T.voidRateMultiple * Math.max(v.baselineRate, 0.005))
      out.push({ ruleId: 'void_spike', severity: 'critical', storeId: v.storeId, dedupeKey: k('void_spike', v.storeId), audience: STORE,
        title: `Void rate spike at ${v.storeId}`, detail: `${v.todayVoids} voids in ${v.todayBills} bills today (${(rate * 100).toFixed(1)}%) vs ${(v.baselineRate * 100).toFixed(1)}% usual — over ${T.voidRateMultiple}×.` });
  }

  for (const u of s.voucherUse) if (u.count > T.voucherUsesPerTillPerDay)
    out.push({ ruleId: 'voucher_abuse', severity: 'warning', storeId: u.storeId, dedupeKey: k('voucher_abuse', `${u.storeId}_${u.tillId}`), audience: STORE,
      title: `Voucher used ${u.count}× on one till at ${u.storeId}`, detail: `Till ${u.tillId} redeemed ${u.count} vouchers today (limit ${T.voucherUsesPerTillPerDay}).` });

  for (const t of s.failedTally)
    out.push({ ruleId: 'tally_sync_failed', severity: 'warning', storeId: t.storeId, dedupeKey: k('tally_sync_failed', t.id), audience: FIN, link: '/finance',
      title: `Tally sync failed${t.storeId ? ` for ${t.storeId}` : ''}`, detail: `${t.error || 'Unknown error'} (attempt ${t.attempts}).` });

  if (s.hourIst >= T.salesCheckHourIst)
    for (const r of s.salesToday) if (r.targetPaise > 0 && r.salesPaise < r.targetPaise * T.salesTargetFraction)
      out.push({ ruleId: 'sales_behind_target', severity: 'critical', storeId: r.storeId, dedupeKey: k('sales_behind_target', r.storeId), audience: STORE, link: '/dashboard',
        title: `${r.storeName} is at ${Math.round((r.salesPaise / r.targetPaise) * 100)}% of today's target`, detail: `${inr(r.salesPaise)} sold vs ${inr(r.targetPaise)} target; below ${T.salesTargetFraction * 100}% by ${T.salesCheckHourIst}:00.` });

  return out;
}

const RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
export const bySeverity = <T extends { severity: AlertSeverity }>(a: T, b: T) => RANK[a.severity] - RANK[b.severity];
