'use client';
import * as React from 'react';
import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import { Badge, Button, Card, Dialog, EmptyState, Field, Kpi, Select, SlideOver, StaggerGrid } from '@texafashions/ui';
import { DataTable, PageHead, StatusBadge, Tabbed, inr, useCommand, useRows } from '../scm/kit';
import { HQ_ROLES, OmsNav, dt, useRole, type Doc } from './shared';

const SCENARIOS = [
  ['prepaid', 'Prepaid order (ships from warehouse)'], ['cod', 'Cash-on-delivery order'], ['bopis', 'Click & collect (BOPIS)'], ['split', 'Split across two locations'],
  ['out_of_stock', 'Out of stock → awaiting stock'], ['high_risk_cod', 'High-risk COD (risk score)'], ['bad_sku', 'Poison event (unknown SKU → retry queue)'],
] as const;
const DONE = ['delivered', 'collected', 'cancelled', 'expired'];
const ACTION = ['new', 'awaiting_stock', 'rto'];

export function SimulateButton({ size = 'sm' as 'sm' | 'md' }) {
  const [open, setOpen] = React.useState(false); const [scn, setScn] = React.useState<string>('prepaid'); const [n, setN] = React.useState(1); const { run, busy } = useCommand();
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}><FlaskConical className="size-4" />Simulate web order</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Simulate a web order">
        <form className="flex flex-col gap-4" onSubmit={async (e) => {
          e.preventDefault();
          const r = await run('simulateWebOrder', { scenario: scn as never, count: n }, (x) => { const f = (x.results as Doc[])[0]!; return f.eventStatus === 'processed' ? `${f.orderName} → ${String(f.status).replace(/_/g, ' ')}${f.strategy ? ` (${f.strategy})` : ''}` : `${f.orderName ?? 'Event'} ${f.eventStatus} — parked in the retry queue: ${f.error ?? ''}`; });
          if (r) setOpen(false);
        }}>
          <p className="text-sm text-soft">Builds a Shopify-shaped <code>orders/create</code> payload from live stock and runs it through the same ingest, risk, allocation and reservation path as the real webhook.</p>
          <Field label="Scenario"><Select value={scn} onChange={(e) => setScn(e.target.value)}>{SCENARIOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="How many"><Select value={n} onChange={(e) => setN(Number(e.target.value))}>{[1, 3, 5, 10].map((v) => <option key={v}>{v}</option>)}</Select></Field>
          <div className="flex justify-end"><Button type="submit" loading={busy}>Create</Button></div>
        </form>
      </Dialog>
    </>
  );
}

export function OmsHome() {
  const role = useRole(); const hq = HQ_ROLES.includes(role);
  const orders = useRows('webOrders', {}, hq); const [tab, setTab] = React.useState<'all' | 'action' | 'flight' | 'done'>('all'); const [sel, setSel] = React.useState<Doc | null>(null);
  const rows = React.useMemo(() => orders?.filter((o) => tab === 'all' || (tab === 'action' ? ACTION.includes(o.status) || o.needsAttention || o.refundDue : tab === 'done' ? DONE.includes(o.status) : !DONE.includes(o.status) && !ACTION.includes(o.status))) ?? null, [orders, tab]);
  const count = (f: (o: Doc) => boolean) => orders?.filter(f).length ?? 0;
  if (!hq) return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5"><PageHead title="E-commerce / OMS" sub="Web orders contain customer details and are visible to head-office roles. Store teams work from pick lists." /><OmsNav current="/oms" />
      <Card><EmptyState kind="bunny" title="Your store’s web work lives under Fulfilment" action={<Link href="/oms/fulfilment"><Button>Open fulfilment</Button></Link>} /></Card></div>
  );
  const sim = ['super_admin', 'warehouse_manager', 'cfo'].includes(role);
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHead title="E-commerce / OMS" sub="Shopify web orders → allocation → pick → pack scan → courier · click & collect · RTO · COD" actions={sim ? <SimulateButton /> : undefined} />
      <OmsNav current="/oms" />
      <StaggerGrid className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi label="Open orders" value={count((o) => !DONE.includes(o.status))} tone="sky" hint="not yet delivered / collected" />
        <Kpi label="Awaiting stock" value={count((o) => o.status === 'awaiting_stock')} tone="butter" hint="cannot be allocated" />
        <Kpi label="Ready for pickup" value={count((o) => o.status === 'ready_for_pickup')} tone="mint" hint="BOPIS, 48 h hold" />
        <Kpi label="In transit" value={count((o) => ['shipped', 'partially_shipped'].includes(o.status))} tone="lavender" hint="with the courier" />
        <Kpi label="RTO / refund due" value={count((o) => o.status === 'rto' || o.refundDue)} tone="blush" hint="needs a person" />
      </StaggerGrid>
      <Tabbed value={tab} onChange={setTab} tabs={[{ value: 'all', label: 'All' }, { value: 'action', label: 'Needs attention' }, { value: 'flight', label: 'In flight' }, { value: 'done', label: 'Done' }]} />
      <DataTable rows={rows} onRow={setSel} empty={<EmptyState kind="bunny" title="No web orders" action={sim ? <SimulateButton size="md" /> : undefined} />} cols={[
        { key: 'orderName', header: 'Order', cell: (r) => <span><b className="font-medium">{r.orderName}</b><span className="block text-xs text-soft">{r.number}</span></span> },
        { key: 'customer', header: 'Customer', cell: (r) => <span>{r.customer?.name}<span className="block text-xs text-soft">{r.fulfilmentType === 'bopis' ? `Pickup · ${r.pickupStoreId}` : `${r.shipTo?.city}, ${r.shipTo?.state}`}</span></span> },
        { key: 'pay', header: 'Payment', cell: (r) => <Badge tone={r.paymentMode === 'cod' ? 'butter' : 'mint'}>{r.paymentMode === 'cod' ? (r.fulfilmentType === 'bopis' ? 'Pay at store' : 'COD') : 'Prepaid'}</Badge> },
        { key: 'total', header: 'Total', align: 'right', cell: (r) => inr(r.totalPaise) },
        { key: 'risk', header: 'Risk', cell: (r) => <Badge tone={r.risk?.level === 'high' ? 'cherry' : r.risk?.level === 'medium' ? 'butter' : 'mint'}>{r.risk?.level ?? '—'} {r.risk?.score ?? ''}</Badge> },
        { key: 'parcels', header: 'Fulfilled from', cell: (r) => (r.units?.length ? [...new Set((r.units as Doc[]).map((u) => u.locationId))].join(' + ') : '—') },
        { key: 'status', header: 'Status', cell: (r) => <span className="flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.needsAttention && <Badge tone="cherry">attention</Badge>}{r.refundDue && <Badge tone="blush">refund due</Badge>}</span> },
        { key: 'createdAt', header: 'Received', cell: (r) => dt(r.createdAt), mobile: 'hide' },
      ]} />
      <SlideOver open={!!sel} onClose={() => setSel(null)} width={620} title={sel ? `${sel.orderName} · ${sel.number}` : ''}>{sel && <OrderDetail id={sel.id} />}</SlideOver>
    </div>
  );
}

function OrderDetail({ id }: { id: string }) {
  const rows = useRows('webOrders', {}); const o = rows?.find((r) => r.id === id); const { run, busy } = useCommand();
  const [cancel, setCancel] = React.useState(false); const [reason, setReason] = React.useState('Customer request');
  if (!o) return <p className="text-sm text-soft">Loading…</p>;
  const canCancel = !['cancelled', 'delivered', 'collected', 'expired', 'rto'].includes(o.status) && !(o.units as Doc[]).some((u) => u.shipmentId);
  return (
    <div className="flex flex-col gap-5 text-sm">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={o.status} /><Badge tone={o.paymentMode === 'cod' ? 'butter' : 'mint'}>{o.paymentMode === 'cod' ? 'COD' : 'Prepaid'} · {o.gateway}</Badge><Badge tone={o.fulfilmentType === 'bopis' ? 'sky' : 'lavender'}>{o.fulfilmentType === 'bopis' ? `Pickup ${o.pickupStoreId}` : 'Ship to customer'}</Badge>{o.source === 'simulated' && <Badge tone="butter">simulated</Badge>}</div>
      <section><h3 className="mb-1 font-medium">Customer</h3><p>{o.customer?.name} · {o.customer?.mobile ?? 'no mobile'}</p>{o.shipTo?.address1 && <p className="text-soft">{o.shipTo.address1}, {o.shipTo.city}, {o.shipTo.state} {o.shipTo.pincode}</p>}{o.giftNote && <p className="mt-1 rounded-xl bg-butter/50 p-2">🎁 “{o.giftNote}”</p>}</section>
      <section>
        <h3 className="mb-1 font-medium">Risk score <Badge tone={o.risk?.level === 'high' ? 'cherry' : o.risk?.level === 'medium' ? 'butter' : 'mint'}>{o.risk?.level} · {o.risk?.score}/100</Badge></h3>
        <ul className="list-disc pl-5 text-xs text-soft">{(o.risk?.reasons as string[] | undefined)?.length ? (o.risk.reasons as string[]).map((r) => <li key={r}>{r}</li>) : <li>No risk signals</li>}</ul>
        <p className="mt-1 text-xs text-soft">Rule-based and explainable; it informs people but never blocks an order automatically.</p>
      </section>
      <section>
        <h3 className="mb-1 font-medium">Items</h3>
        <ul className="divide-y divide-line/60 rounded-2xl border border-line/60">{(o.lines as Doc[]).map((l) => <li key={l.skuId} className="flex justify-between gap-3 px-3 py-2"><span>{l.qty}× {l.name}<span className="block text-xs text-soft">{l.skuId} · GST {l.gstRate}%</span></span><span className="num">{inr(l.netPaise)}</span></li>)}
          {o.shippingPaise > 0 && <li className="flex justify-between px-3 py-2"><span>Shipping</span><span className="num">{inr(o.shippingPaise)}</span></li>}
          <li className="flex justify-between px-3 py-2 font-medium"><span>Total</span><span className="num">{inr(o.totalPaise)}</span></li></ul>
        {o.needsReview && <p className="mt-1 text-xs text-cherry">Line totals differ from Shopify’s total by {inr(Math.abs(o.totalVariancePaise))} — review the discount.</p>}
      </section>
      {(o.units as Doc[]).length > 0 && <section><h3 className="mb-1 font-medium">Parcels / pick lists</h3>
        <ul className="flex flex-col gap-2">{(o.units as Doc[]).map((u) => <li key={u.pickListId} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-card2 px-3 py-2"><span><b className="font-medium">{u.number}</b><span className="block text-xs text-soft">{u.locationName}{u.awb ? ` · ${u.courier} ${u.awb}` : ''}</span></span><span className="flex gap-1"><StatusBadge status={u.status} />{u.shipmentStatus && <StatusBadge status={u.shipmentStatus} />}</span></li>)}</ul></section>}
      {o.allocation && !o.allocation.complete && <section className="rounded-2xl bg-butter/40 p-3"><b>Short:</b> {(o.allocation.shortages as Doc[]).map((s) => `${s.qty}× ${s.skuId}`).join(', ')}
        <div className="mt-2"><Button size="sm" variant="soft" loading={busy} onClick={() => run('allocateOrder', { orderId: o.id }, (r) => (r.status === 'allocated' ? 'Allocated' : 'Still short'))}>Retry allocation</Button></div></section>}
      {o.needsAttention && <section className="rounded-2xl bg-blush/50 p-3">⚠ {o.needsAttention}</section>}
      <section><h3 className="mb-1 font-medium">Timeline</h3><ol className="flex flex-col gap-1.5 border-l-2 border-line/70 pl-4 text-xs">{[...((o.timeline as Doc[]) ?? [])].reverse().map((t, i) => <li key={i}><span className="text-soft">{dt(t.at)}</span> — {t.text}</li>)}</ol></section>
      {canCancel && <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={() => setCancel(true)}>Cancel order</Button></div>}
      <Dialog open={cancel} onClose={() => setCancel(false)} title={`Cancel ${o.orderName}?`}>
        <form className="flex flex-col gap-3" onSubmit={async (e) => { e.preventDefault(); if (await run('cancelOrder', { orderId: o.id, reason }, 'Order cancelled — reservations released')) setCancel(false); }}>
          <Field label="Reason"><input className="w-full rounded-2xl border border-line bg-card px-4 py-2" value={reason} onChange={(e) => setReason(e.target.value)} minLength={2} required /></Field>
          <p className="text-xs text-soft">Reserved stock is released. A prepaid order is flagged for refund.</p>
          <div className="flex justify-end"><Button type="submit" loading={busy}>Cancel order</Button></div>
        </form>
      </Dialog>
    </div>
  );
}
