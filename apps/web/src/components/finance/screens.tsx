'use client';
import * as React from 'react';
import { Badge, Card, Dialog, EmptyState, Kpi, Skeleton, StaggerGrid } from '@texafashions/ui';
import type { AgeBucket } from '@texafashions/domain';
import { data } from '@/lib/data';
import { DataTable, PageHead, dateStr, inr, useMaster } from '../scm/kit';
import { Bars, FinanceNav, useReport, type Doc } from './shared';

const REF_COLLECTION: Record<string, string> = {
  sale: 'sales', return: 'returns', grn: 'grns', purchaseInvoice: 'purchaseInvoices', paymentVoucher: 'paymentVouchers',
  stockTransfer: 'stockTransfers', shipment: 'shipments', bopis: 'pickLists',
};
const LEDGER_TYPE_TONE: Record<string, 'mint' | 'blush' | 'sky' | 'butter' | 'lavender'> = { Asset: 'sky', Liability: 'blush', Income: 'mint', Expense: 'butter', Equity: 'lavender' };

// ───────────────────────── Chart of accounts
export function ChartOfAccounts() {
  const { rows, loading } = useMaster('ledgers');
  const sorted = [...rows].sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.id).localeCompare(String(b.id)));
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHead title="Chart of accounts" sub="Ledger master — type, Tally group and the exact Tally ledger name used by the sync agent." />
      <FinanceNav current="/finance" />
      <DataTable rows={loading ? null : sorted} empty={<EmptyState kind="capybara" title="No ledgers seeded" />} cols={[
        { key: 'id', header: 'Code', cell: (r) => <b className="font-medium">{r.id}</b> }, { key: 'name', header: 'Name' },
        { key: 'type', header: 'Type', cell: (r) => <Badge tone={LEDGER_TYPE_TONE[String(r.type)] ?? 'lavender'}>{String(r.type)}</Badge> },
        { key: 'parentGroup', header: 'Tally group' }, { key: 'tallyName', header: 'Tally ledger name', mobile: 'hide' },
      ]} />
    </div>
  );
}

// ───────────────────────── Journal viewer, with drill-down to the source document
function JournalDrillDown({ j }: { j: Doc }) {
  const [src, setSrc] = React.useState<Doc | null | undefined>(undefined);
  React.useEffect(() => {
    const coll = REF_COLLECTION[j.refType];
    if (!coll) { setSrc(null); return; }
    setSrc(undefined);
    data().scm.get(coll as never, j.refId).then(setSrc).catch(() => setSrc(null));
  }, [j.refType, j.refId]);
  const drTotal = (j.lines as Doc[]).reduce((a, l) => a + l.drPaise, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span><b className="font-medium">{j.event}</b> · {dateStr(j.day)} · cost centre {j.storeId}</span>
        <Badge tone="mint">balanced — Dr {inr(drTotal)} = Cr {inr(drTotal)}</Badge>
      </div>
      <Card className="overflow-x-auto p-0"><table className="w-full text-sm">
        <thead className="bg-card2 text-left text-xs text-soft"><tr><th className="p-3">Ledger</th><th className="p-3">Narration</th><th className="p-3 text-right">Debit</th><th className="p-3 text-right">Credit</th></tr></thead>
        <tbody>{(j.lines as Doc[]).map((l, i) => <tr key={i} className="border-t border-line/60"><td className="p-3">{l.ledgerId}</td><td className="p-3 text-soft">{l.narration ?? '—'}</td><td className="num p-3">{l.drPaise ? inr(l.drPaise) : '—'}</td><td className="num p-3">{l.crPaise ? inr(l.crPaise) : '—'}</td></tr>)}</tbody>
      </table></Card>
      <div>
        <h4 className="mb-1 text-xs font-medium text-soft">Source document — {j.refType} {j.refId}</h4>
        {src === undefined && REF_COLLECTION[j.refType] ? <Skeleton className="h-16" /> : !src ? <p className="text-sm text-soft">No drill-down available for this reference type.</p> : (
          <Card className="p-3 text-sm">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
              {['number', 'invoiceNo', 'poNumber', 'vendorName', 'status', 'storeId', 'locationId', 'totalPaise', 'balancePaise', 'valuePaise', 'amountPaise'].filter((k) => src[k] !== undefined).map((k) => (
                <div key={k}><dt className="text-xs text-soft">{k}</dt><dd>{typeof src[k] === 'number' && k.toLowerCase().includes('paise') ? inr(src[k]) : String(src[k])}</dd></div>
              ))}
            </dl>
          </Card>
        )}
      </div>
    </div>
  );
}
export function JournalViewer() {
  const [rows, setRows] = React.useState<(Doc & { id: string })[] | null>(null);
  const [open, setOpen] = React.useState<Doc | null>(null);
  React.useEffect(() => data().scm.subscribe('journals', { limit: 300 }, (r) => setRows([...r].sort((a: Doc, b: Doc) => String(b.at ?? '').localeCompare(String(a.at ?? ''))))), []);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHead title="Journals" sub="Every GL posting, append-only. Click a row to drill down into its lines and source document." />
      <FinanceNav current="/finance/journals" />
      <DataTable rows={rows} onRow={setOpen} empty={<EmptyState kind="bunny" title="No journals posted yet" />} cols={[
        { key: 'day', header: 'Date', cell: (r) => dateStr(r.day) }, { key: 'event', header: 'Event' }, { key: 'storeId', header: 'Cost centre' },
        { key: 'lines', header: 'Lines', align: 'right', cell: (r) => (r.lines as Doc[]).length },
        { key: 'total', header: 'Amount', align: 'right', cell: (r) => inr((r.lines as Doc[]).reduce((a, l) => a + l.drPaise, 0)) },
        { key: 'refType', header: 'Reference', cell: (r) => <span className="text-xs text-soft">{r.refType} · {r.refId}</span>, mobile: 'hide' },
      ]} />
      <Dialog open={!!open} onClose={() => setOpen(null)} title={`Journal — ${open?.event ?? ''}`} wide>{open && <JournalDrillDown j={open} />}</Dialog>
    </div>
  );
}

// ───────────────────────── Ageing (AP + AR)
const BUCKET_TONE: Record<AgeBucket, 'mint' | 'butter' | 'blush' | 'cherry'> = { '0-30': 'mint', '31-60': 'butter', '61-90': 'blush', '90+': 'cherry' };
function AgeingView({ title, sub, nav, report, amountKey, dateLabel, dateKey, idLabel }: { title: string; sub: string; nav: string; report: 'apAgeingReport' | 'arAgeingReport'; amountKey: string; dateLabel: string; dateKey: string; idLabel: string }) {
  const q = useReport(report, {});
  const h = q.data as Doc | undefined;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHead title={title} sub={sub} />
      <FinanceNav current={nav} />
      {!h ? <Skeleton className="h-24" /> : (
        <>
          <StaggerGrid className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {(['0-30', '31-60', '61-90', '90+'] as AgeBucket[]).map((b) => <Kpi key={b} label={`${b} days`} value={h.buckets[b].amountPaise / 100} format={(n) => inr(Math.round(n) * 100)} tone={BUCKET_TONE[b]} hint={`${h.buckets[b].count} item(s)`} />)}
          </StaggerGrid>
          <Card><h3 className="mb-3 font-medium">By ageing bucket</h3><Bars tone="blush" rows={(['0-30', '31-60', '61-90', '90+'] as AgeBucket[]).map((b) => ({ label: b, value: h.buckets[b].amountPaise, sub: inr(h.buckets[b].amountPaise) }))} /></Card>
        </>
      )}
      <DataTable rows={h?.rows ?? null} empty={<EmptyState kind="capybara" title="Nothing outstanding" />} cols={[
        { key: 'id', header: idLabel }, { key: dateKey, header: dateLabel, cell: (r) => dateStr(r[dateKey]) },
        { key: amountKey, header: 'Amount', align: 'right', cell: (r) => inr(r[amountKey]) },
        { key: 'bucket', header: 'Bucket', cell: (r) => <Badge tone={BUCKET_TONE[r.bucket as AgeBucket]}>{r.bucket}</Badge> },
      ]} />
      {h?.note && <p className="text-xs text-soft">{h.note}</p>}
    </div>
  );
}
export const ApAgeing = () => <AgeingView title="AP ageing" sub="Outstanding vendor bills, bucketed by days overdue." nav="/finance/ap-ageing" report="apAgeingReport" amountKey="balancePaise" dateLabel="Due date" dateKey="dueDate" idLabel="Invoice" />;
export const ArAgeing = () => <AgeingView title="AR ageing" sub="COD cash currently with the courier, bucketed by days outstanding." nav="/finance/ar-ageing" report="arAgeingReport" amountKey="amountPaise" dateLabel="Order date" dateKey="createdAt" idLabel="Order" />;

// ───────────────────────── Store P&L by cost centre
export function StorePnl() {
  const q = useReport('storePnlReport', {});
  const h = q.data as Doc | undefined;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHead title="Store P&L by cost centre" sub={h ? `Period ${h.period} · revenue less cost of goods sold, from posted journals.` : 'Loading…'} />
      <FinanceNav current="/finance/store-pnl" />
      {!h ? <Skeleton className="h-24" /> : (
        <>
          <StaggerGrid className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Kpi label="Revenue" value={h.totalRevenuePaise / 100} format={(n) => inr(Math.round(n) * 100)} tone="mint" />
            <Kpi label="COGS" value={h.totalCogsPaise / 100} format={(n) => inr(Math.round(n) * 100)} tone="butter" />
            <Kpi label="Gross profit" value={(h.totalRevenuePaise - h.totalCogsPaise) / 100} format={(n) => inr(Math.round(n) * 100)} tone="sky" />
          </StaggerGrid>
          <Card><h3 className="mb-3 font-medium">Revenue by store</h3><Bars tone="mint" rows={(h.rows as Doc[]).map((r) => ({ label: r.storeName, value: r.revenuePaise, sub: inr(r.revenuePaise) }))} /></Card>
        </>
      )}
      <DataTable rows={h?.rows ?? null} empty={<EmptyState kind="bunny" title="No sales journals this period" />} cols={[
        { key: 'storeName', header: 'Store' }, { key: 'revenuePaise', header: 'Revenue', align: 'right', cell: (r) => inr(r.revenuePaise) },
        { key: 'cogsPaise', header: 'COGS', align: 'right', cell: (r) => inr(r.cogsPaise) }, { key: 'grossProfitPaise', header: 'Gross profit', align: 'right', cell: (r) => inr(r.grossProfitPaise) },
        { key: 'grossMarginPct', header: 'Margin %', align: 'right', cell: (r) => `${r.grossMarginPct}%` },
      ]} />
    </div>
  );
}

// ───────────────────────── Budget vs actual
export function BudgetVsActual() {
  const q = useReport('budgetVsActualReport', {});
  const h = q.data as Doc | undefined;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHead title="Budget vs actual" sub={h ? `Period ${h.period} · sales budget per store, set at seed time (CFO can revise via setBudget).` : 'Loading…'} />
      <FinanceNav current="/finance/budget-vs-actual" />
      {!h ? <Skeleton className="h-24" /> : (
        <>
          <StaggerGrid className="grid grid-cols-2 gap-4">
            <Kpi label="Total budget" value={h.totalBudgetPaise / 100} format={(n) => inr(Math.round(n) * 100)} tone="lavender" />
            <Kpi label="Total actual" value={h.totalActualPaise / 100} format={(n) => inr(Math.round(n) * 100)} tone={h.totalActualPaise >= h.totalBudgetPaise ? 'mint' : 'blush'} />
          </StaggerGrid>
          <Card><h3 className="mb-3 font-medium">Variance % by store</h3><Bars tone="sky" rows={(h.rows as Doc[]).map((r) => ({ label: r.storeName, value: r.variancePct ?? 0, sub: r.variancePct === null ? 'no budget' : `${r.variancePct}%` }))} /></Card>
        </>
      )}
      <DataTable rows={h?.rows ?? null} empty={<EmptyState kind="capybara" title="No budgets set" />} cols={[
        { key: 'storeName', header: 'Store' }, { key: 'budgetPaise', header: 'Budget', align: 'right', cell: (r) => inr(r.budgetPaise) },
        { key: 'revenuePaise', header: 'Actual', align: 'right', cell: (r) => inr(r.revenuePaise) },
        { key: 'variancePaise', header: 'Variance', align: 'right', cell: (r) => <span className={r.variancePaise < 0 ? 'text-cherry' : ''}>{inr(r.variancePaise)}</span> },
        { key: 'variancePct', header: 'Variance %', align: 'right', cell: (r) => (r.variancePct === null ? '—' : `${r.variancePct}%`) },
      ]} />
    </div>
  );
}
