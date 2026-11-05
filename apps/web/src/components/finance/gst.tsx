'use client';
import * as React from 'react';
import { Badge, Button, Card, EmptyState, Kpi, Skeleton, StaggerGrid } from '@texafashions/ui';
import { Download } from 'lucide-react';
import { DataTable, PageHead, dateStr, inr } from '../scm/kit';
import { downloadCsv, FinanceNav, useReport, type Doc } from './shared';

/** These report rows come back as plain objects (no Firestore doc id) — DataTable needs a synthetic one. */
const withId = (rows: Doc[]) => rows.map((r, i) => ({ id: String(i), ...r }));

const MISMATCH_TONE: Record<string, 'mint' | 'butter' | 'blush' | 'cherry'> = { matched: 'mint', value_mismatch: 'butter', missing_in_books: 'cherry', missing_in_2b: 'blush' };
const MISMATCH_LABEL: Record<string, string> = { matched: 'Matched', value_mismatch: 'Value mismatch', missing_in_books: 'Missing in books', missing_in_2b: 'Missing in 2B' };

/** GSTR-1, GSTR-3B and 2B reconciliation — read-model reports computed on demand (same pattern as the other Finance reports). */
export function GstReports() {
  const [tab, setTab] = React.useState<'gstr1' | 'gstr3b' | '2b'>('gstr1');
  const g1 = useReport('gstr1Report', {}, tab === 'gstr1');
  const g3b = useReport('gstr3bReport', {}, tab === 'gstr3b');
  const g2b = useReport('gstr2bMismatchReport', {}, tab === '2b');
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHead title="GST returns" sub="GSTR-1 (B2C/B2B/HSN), GSTR-3B and 2B reconciliation for the current month — computed from sales, web orders and purchase invoices." />
      <FinanceNav current="/finance/gst" />
      <div className="flex w-full gap-1 overflow-x-auto rounded-pill bg-card2 p-1">
        {([['gstr1', 'GSTR-1'], ['gstr3b', 'GSTR-3B'], ['2b', '2B mismatch']] as const).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={`whitespace-nowrap rounded-pill px-4 py-1.5 text-sm ${tab === v ? 'bg-card shadow-soft' : 'text-soft hover:text-ink'}`}>{label}</button>
        ))}
      </div>
      {tab === 'gstr1' && (g1.data ? <Gstr1Tables h={g1.data as Doc} /> : <Skeleton className="h-48" />)}
      {tab === 'gstr3b' && (g3b.data ? <Gstr3bTable h={g3b.data as Doc} /> : <Skeleton className="h-48" />)}
      {tab === '2b' && (g2b.data ? <Gstr2bView h={g2b.data as Doc} /> : <Skeleton className="h-48" />)}
    </div>
  );
}

function ExportButton({ filename, headers, rows }: { filename: string; headers: string[]; rows: (string | number)[][] }) {
  return <Button size="sm" variant="soft" onClick={() => downloadCsv(filename, headers, rows)}><Download className="size-4" />Export to Excel</Button>;
}

function Gstr1Tables({ h }: { h: Doc }) {
  const b2c = h.b2c as Doc[]; const b2b = h.b2b as Doc[]; const hsn = h.hsn as Doc[];
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between"><h3 className="font-medium">B2C (Others) — by place of supply + rate</h3><ExportButton filename={`gstr1-b2c-${h.period}.csv`} headers={['State', 'Rate %', 'Taxable', 'CGST', 'SGST', 'IGST', 'Invoices']} rows={b2c.map((r) => [r.placeOfSupplyState, r.gstRate, r.taxablePaise / 100, r.cgstPaise / 100, r.sgstPaise / 100, r.igstPaise / 100, r.invoiceCount])} /></div>
        <DataTable rows={withId(b2c)} empty={<EmptyState kind="capybara" title="No B2C sales this period" />} cols={[
          { key: 'placeOfSupplyState', header: 'State' }, { key: 'gstRate', header: 'Rate', align: 'right', cell: (r) => `${r.gstRate}%` },
          { key: 'taxablePaise', header: 'Taxable', align: 'right', cell: (r) => inr(r.taxablePaise) }, { key: 'cgstPaise', header: 'CGST', align: 'right', cell: (r) => inr(r.cgstPaise) },
          { key: 'sgstPaise', header: 'SGST', align: 'right', cell: (r) => inr(r.sgstPaise) }, { key: 'igstPaise', header: 'IGST', align: 'right', cell: (r) => inr(r.igstPaise) },
          { key: 'invoiceCount', header: 'Invoices', align: 'right' },
        ]} />
      </Card>
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between"><h3 className="font-medium">B2B — invoice-wise</h3><ExportButton filename={`gstr1-b2b-${h.period}.csv`} headers={['GSTIN', 'Invoice', 'Date', 'State', 'Taxable', 'CGST', 'SGST', 'IGST']} rows={b2b.map((r) => [r.customerGstin, r.invoiceNo, r.invoiceDate, r.placeOfSupplyState, r.taxablePaise / 100, r.cgstPaise / 100, r.sgstPaise / 100, r.igstPaise / 100])} /></div>
        <DataTable rows={withId(b2b)} empty={<EmptyState kind="bunny" title="No B2B invoices this period (this B2C retailer rarely sells to GSTIN holders)" />} cols={[
          { key: 'customerGstin', header: 'GSTIN' }, { key: 'invoiceNo', header: 'Invoice' }, { key: 'invoiceDate', header: 'Date', cell: (r) => dateStr(r.invoiceDate) },
          { key: 'taxablePaise', header: 'Taxable', align: 'right', cell: (r) => inr(r.taxablePaise) }, { key: 'igstPaise', header: 'Total tax', align: 'right', cell: (r) => inr(r.cgstPaise + r.sgstPaise + r.igstPaise) },
        ]} />
      </Card>
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between"><h3 className="font-medium">HSN-wise summary</h3><ExportButton filename={`gstr1-hsn-${h.period}.csv`} headers={['HSN', 'Rate %', 'Qty', 'Taxable', 'Total tax']} rows={hsn.map((r) => [r.hsn, r.gstRate, r.totalQty, r.taxablePaise / 100, r.totalTaxPaise / 100])} /></div>
        <DataTable rows={withId(hsn)} empty={<EmptyState kind="capybara" title="Nothing to summarise" />} cols={[
          { key: 'hsn', header: 'HSN' }, { key: 'gstRate', header: 'Rate', align: 'right', cell: (r) => `${r.gstRate}%` }, { key: 'totalQty', header: 'Qty', align: 'right' },
          { key: 'taxablePaise', header: 'Taxable', align: 'right', cell: (r) => inr(r.taxablePaise) }, { key: 'totalTaxPaise', header: 'Total tax', align: 'right', cell: (r) => inr(r.totalTaxPaise) },
        ]} />
      </Card>
    </div>
  );
}

function Gstr3bTable({ h }: { h: Doc }) {
  const t = h.table as Doc;
  return (
    <div className="flex flex-col gap-5">
      <StaggerGrid className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Kpi label="Outward taxable value" value={t.outwardTaxableSupplies.taxablePaise / 100} format={(n) => inr(Math.round(n) * 100)} tone="sky" />
        <Kpi label="Eligible ITC" value={(t.eligibleItc.cgstPaise + t.eligibleItc.sgstPaise + t.eligibleItc.igstPaise) / 100} format={(n) => inr(Math.round(n) * 100)} tone="mint" />
        <Kpi label="Net tax payable" value={(t.netTaxPayable.cgstPaise + t.netTaxPayable.sgstPaise + t.netTaxPayable.igstPaise) / 100} format={(n) => inr(Math.round(n) * 100)} tone="blush" />
      </StaggerGrid>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-card2 text-left text-xs text-soft"><tr><th className="p-3">Table</th><th className="p-3 text-right">CGST</th><th className="p-3 text-right">SGST</th><th className="p-3 text-right">IGST</th></tr></thead>
          <tbody>
            <tr className="border-t border-line/60"><td className="p-3">3.1 Outward taxable supplies</td><td className="num p-3">{inr(t.outwardTaxableSupplies.cgstPaise)}</td><td className="num p-3">{inr(t.outwardTaxableSupplies.sgstPaise)}</td><td className="num p-3">{inr(t.outwardTaxableSupplies.igstPaise)}</td></tr>
            <tr className="border-t border-line/60"><td className="p-3">4 Eligible ITC</td><td className="num p-3">{inr(t.eligibleItc.cgstPaise)}</td><td className="num p-3">{inr(t.eligibleItc.sgstPaise)}</td><td className="num p-3">{inr(t.eligibleItc.igstPaise)}</td></tr>
            <tr className="border-t border-line/60 font-medium"><td className="p-3">Net tax payable</td><td className="num p-3">{inr(t.netTaxPayable.cgstPaise)}</td><td className="num p-3">{inr(t.netTaxPayable.sgstPaise)}</td><td className="num p-3">{inr(t.netTaxPayable.igstPaise)}</td></tr>
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-soft">ITC is assumed fully eligible for this demo — no blocked-credit (Sec. 17(5)) rules applied.</p>
    </div>
  );
}

function Gstr2bView({ h }: { h: Doc }) {
  const rows = h.rows as Doc[];
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Books vs GSTR-2B</h3>
        <ExportButton filename={`gstr2b-mismatch-${h.period}.csv`} headers={['Vendor GSTIN', 'Invoice', 'Status', 'Book tax', '2B tax', 'Delta']} rows={rows.map((r) => [r.vendorGstin, r.invoiceNo, MISMATCH_LABEL[r.status], (r.bookTaxPaise ?? 0) / 100, (r.gstr2bTaxPaise ?? 0) / 100, r.deltaPaise / 100])} />
      </div>
      <DataTable rows={withId(rows)} empty={<EmptyState kind="bunny" title="Nothing filed in 2B yet this period" />} cols={[
        { key: 'vendorGstin', header: 'Vendor GSTIN' }, { key: 'invoiceNo', header: 'Invoice' },
        { key: 'status', header: 'Status', cell: (r) => <Badge tone={MISMATCH_TONE[r.status]}>{MISMATCH_LABEL[r.status]}</Badge> },
        { key: 'bookTaxPaise', header: 'Book tax', align: 'right', cell: (r) => inr(r.bookTaxPaise) }, { key: 'gstr2bTaxPaise', header: '2B tax', align: 'right', cell: (r) => inr(r.gstr2bTaxPaise) },
        { key: 'deltaPaise', header: 'Delta', align: 'right', cell: (r) => <span className={r.deltaPaise ? 'text-cherry' : ''}>{inr(r.deltaPaise)}</span> },
      ]} />
    </Card>
  );
}
