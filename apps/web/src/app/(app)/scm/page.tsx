'use client';
import Link from 'next/link';
import { ArrowRight, Boxes, ClipboardCheck, FileText, Receipt, Repeat, ShoppingCart, Sparkles, Truck, Wallet } from 'lucide-react';
import { Badge, Card, Kpi, StaggerGrid } from '@texafashions/ui';
import { daysUntil } from '@texafashions/domain';
import { useRows, inr } from '@/components/scm/kit';

export default function ScmHome() {
  const pos = useRows('purchaseOrders'); const prs = useRows('purchaseRequisitions'); const pay = useRows('paymentVouchers'); const inv = useRows('purchaseInvoices'); const qc = useRows('qcInspections');
  const put = useRows('putawayTasks'); const bills = useRows('apBills'); const sug = useRows('replenishmentSuggestions', { where: [['status', '==', 'open']], limit: 1000 }); const tr = useRows('stockTransfers');
  const pending = [...(prs ?? []), ...(pos ?? []), ...(pay ?? [])].filter((d) => d.status === 'pending_approval').length;
  const open = (pos ?? []).filter((p) => ['approved', 'sent', 'acknowledged', 'partially_received'].includes(p.status));
  const hold = (inv ?? []).filter((i) => i.status === 'hold').length;
  const msme = (bills ?? []).filter((b) => b.isMsme && b.status !== 'paid' && daysUntil(new Date(b.dueDate)) <= 7).length;
  const tiles = [
    { href: '/scm/replenishment', icon: Sparkles, title: 'Replenishment', text: 'Forecast-driven suggestions → requisitions', n: (sug ?? []).filter((s) => s.urgency === 'critical').length, badge: 'critical' },
    { href: '/scm/purchase', icon: ShoppingCart, title: 'Purchasing', text: 'PR → RFQ → PO · import & domestic', n: pending, badge: 'awaiting approval' },
    { href: '/scm/receiving', icon: Truck, title: 'Receiving', text: 'Gate → GRN scan → QC → putaway', n: (qc ?? []).filter((q) => q.status === 'pending' || q.status === 'rework').length + (put ?? []).filter((p) => p.status !== 'done').length, badge: 'to do' },
    { href: '/scm/payables', icon: Wallet, title: 'Payables', text: 'Invoice OCR · 3-way match · payments · landed cost', n: hold, badge: 'on hold' },
    { href: '/scm/transfers', icon: Repeat, title: 'Transfers', text: 'Warehouse ↔ store · e-way bill', n: (tr ?? []).filter((t) => t.status === 'in_transit').length, badge: 'in transit' },
    { href: '/inventory', icon: Boxes, title: 'Inventory', text: 'Stock states, ledger, counts, valuation', n: 0, badge: '' },
  ];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header><h1 className="font-display text-3xl">Supply chain</h1><p className="text-sm text-soft">Procure-to-pay and warehouse operations — every stock movement is written to an append-only ledger.</p></header>
      <StaggerGrid className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Open purchase orders" value={open.length} tone="sky" hint={inr(open.reduce((a, p) => a + p.totalInrPaise, 0))} />
        <Kpi label="Awaiting approval" value={pending} tone="butter" hint="PR · PO · payments" />
        <Kpi label="Invoices on hold" value={hold} tone="blush" hint="failed 3-way match" />
        <Kpi label="MSME bills due ≤ 7d" value={msme} tone="mint" hint="45-day payment rule" />
      </StaggerGrid>
      <StaggerGrid className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href}><Card className="h-full p-5 transition-shadow hover:shadow-pop">
            <div className="flex items-start justify-between"><t.icon className="size-6 text-cherry" />{t.n > 0 && <Badge tone="cherry">{t.n} {t.badge}</Badge>}</div>
            <h2 className="mt-3 font-display text-xl">{t.title}</h2><p className="mt-1 text-sm text-soft">{t.text}</p><span className="mt-3 inline-flex items-center gap-1 text-sm text-cherry">Open <ArrowRight className="size-4" /></span></Card></Link>))}
      </StaggerGrid>
      <Card className="flex items-center gap-3 bg-card2 p-4 text-sm"><ClipboardCheck className="size-5 text-soft" /><FileText className="size-5 text-soft" /><Receipt className="size-5 text-soft" />Open any purchase order to see the animated PR → PO → ASN → GRN → QC → Invoice → Paid tracker.</Card>
    </div>
  );
}
