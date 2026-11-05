'use client';
import * as React from 'react';
import { Plus, Truck } from 'lucide-react';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Select, SlideOver } from '@texafashions/ui';
import { ewayRequired } from '@texafashions/domain';
import { data } from '@/lib/data';
import { useSession } from '@/lib/stores';
import { DataTable, FieldRow, LinesEditor, StatusBadge, dateStr, inr, useCommand, useLocations, useRows, useScope, useSkus, type LineState } from './kit';

type Doc = Record<string, any>;
export function TransfersView() {
  const scope = useScope(); const role = useSession((s) => s.session!.claims.role);
  const from = useRows('stockTransfers', { where: scope.all ? [] : [['fromLocationId', 'in', scope.storeIds.length ? scope.storeIds : ['__none__']]] });
  const to = useRows('stockTransfers', scope.all ? { where: [['status', '!=', '__never__']] } : { where: [['toLocationId', 'in', scope.storeIds.length ? scope.storeIds : ['__none__']]] }, !scope.all);
  const rows = React.useMemo(() => { if (scope.all) return from; if (from === null || to === null) return null; const m = new Map([...from, ...to].map((r) => [r.id, r])); return [...m.values()]; }, [from, to, scope.all]);
  const [form, setForm] = React.useState(false); const [sel, setSel] = React.useState<Doc | null>(null); const [recv, setRecv] = React.useState<Doc | null>(null); const [disp, setDisp] = React.useState<Doc | null>(null);
  const can = ['warehouse_manager', 'store_manager', 'buyer', 'super_admin'].includes(role);
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3"><div><a href="/scm" className="text-xs text-soft hover:text-cherry">← Supply chain</a><h1 className="font-display text-3xl">Stock transfers</h1><p className="text-sm text-soft">Warehouse → store and store → store. E-way bill above ₹50,000; inter-state moves raise a tax invoice.</p></div>
        {can && <Button size="sm" onClick={() => setForm(true)}><Plus className="size-4" />New transfer</Button>}</header>
      <DataTable rows={rows} onRow={setSel} cols={[
        { key: 'number', header: 'Transfer', cell: (r) => <b className="font-medium">{r.number}</b> }, { key: 'route', header: 'Route', cell: (r) => `${r.fromLocationId} → ${r.toLocationId}` },
        { key: 'units', header: 'Units', align: 'right', cell: (r) => (r.lines as Doc[]).reduce((a, l) => a + l.qty, 0) }, { key: 'valuePaise', header: 'Value', align: 'right', cell: (r) => (r.valuePaise ? inr(r.valuePaise) : '—') },
        { key: 'doc', header: 'Document', cell: (r) => (r.status === 'draft' ? '—' : r.docType === 'tax_invoice' ? <Badge tone="lavender">Tax invoice {r.taxInvoice?.number?.split('/').pop()}</Badge> : <Badge tone="sky">Delivery challan</Badge>) },
        { key: 'eway', header: 'E-way bill', cell: (r) => r.ewayBillNo ?? '—' }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        { key: 'act', header: '', cell: (r) => (
          <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {r.status === 'draft' && can && (role !== 'store_manager' || scope.storeIds.includes(r.fromLocationId)) && <Button size="sm" onClick={() => setDisp(r)}><Truck className="size-4" />Dispatch</Button>}
            {r.status === 'in_transit' && can && (scope.all || scope.storeIds.includes(r.toLocationId)) && <Button size="sm" variant="soft" onClick={() => setRecv(r)}>Receive</Button>}
          </span>) },
      ]} empty={<EmptyState kind="capybara" title="No transfers" />} />
      <SlideOver open={form} onClose={() => setForm(false)} width={600} title="New stock transfer"><TransferForm onDone={() => setForm(false)} /></SlideOver>
      <Dialog open={!!disp} onClose={() => setDisp(null)} title={`Dispatch ${disp?.number ?? ''}`}>{disp && <DispatchForm t={disp} onDone={() => setDisp(null)} />}</Dialog>
      <Dialog open={!!recv} onClose={() => setRecv(null)} title={`Receive ${recv?.number ?? ''}`} wide>{recv && <ReceiveForm t={recv} onDone={() => setRecv(null)} />}</Dialog>
      <Dialog open={!!sel} onClose={() => setSel(null)} title={sel?.number ?? ''} wide>{sel && <TransferDetail t={sel} />}</Dialog>
    </div>
  );
}
function TransferForm({ onDone }: { onDone: () => void }) {
  const locs = useLocations(); const scope = useScope(); const { run, busy } = useCommand();
  const fromOptions = locs.filter((l) => scope.all || scope.storeIds.includes(l.id));
  const [from, setFrom] = React.useState(''); const [to, setTo] = React.useState(''); const [lines, setLines] = React.useState<LineState[]>([]); const [avail, setAvail] = React.useState<Record<string, number>>({});
  React.useEffect(() => { if (!from && fromOptions[0]) setFrom(fromOptions[0].id); }, [fromOptions.length]);  
  const scm = data().scm;
  React.useEffect(() => { if (!from) return; return scm.subscribe('stock', { where: [['locationId', '==', from]], limit: 400 }, (rows) => setAvail(Object.fromEntries(rows.map((r) => [r.skuId as string, (r.onHand as number) - (r.reserved as number)])))); }, [from]);  
  const over = lines.filter((l) => l.qty > (avail[l.skuId] ?? 0));
  const fs = locs.find((l) => l.id === from)?.state, ts = locs.find((l) => l.id === to)?.state;
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('createTransfer', { fromLocationId: from, toLocationId: to, lines: lines.map((l) => ({ skuId: l.skuId, qty: l.qty })) }, (x) => `${x.number} created`); if (r) onDone(); }}>
      <FieldRow>
        <Field label="From" required><Select value={from} onChange={(e) => setFrom(e.target.value)}>{fromOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="To" required><Select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Select…</option>{locs.filter((l) => l.id !== from).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
      </FieldRow>
      {fs && ts && fs !== ts && <Badge tone="lavender" className="self-start">Inter-state ({fs} → {ts}): IGST tax invoice will be raised on dispatch</Badge>}
      <Field label="Items"><LinesEditor lines={lines} setLines={setLines} /></Field>
      {lines.length > 0 && <ul className="text-xs text-soft">{lines.map((l) => <li key={l.skuId} className={l.qty > (avail[l.skuId] ?? 0) ? 'text-cherry' : ''}>{l.skuId}: {avail[l.skuId] ?? 0} available at {from}</li>)}</ul>}
      <div className="flex justify-end"><Button type="submit" loading={busy} disabled={!to || !lines.length || over.length > 0}>Create transfer</Button></div>
    </form>
  );
}
function DispatchForm({ t, onDone }: { t: Doc; onDone: () => void }) {
  const { run, busy } = useCommand(); const [veh, setVeh] = React.useState('');
  const [est, setEst] = React.useState<number | null>(null);
  React.useEffect(() => { (async () => { const rows = await data().scm.list('stock', { where: [['locationId', '==', t.fromLocationId]], limit: 400 }); const m = new Map(rows.map((r) => [r.skuId as string, r.avgCostPaise as number])); setEst((t.lines as Doc[]).reduce((a, l) => a + l.qty * (m.get(l.skuId) ?? 0), 0)); })(); }, [t]);
  const needEway = est !== null && ewayRequired(est);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('dispatchTransfer', { transferId: t.id, vehicleNo: veh || null }, (x) => `Dispatched${x.ewayBillNo ? ` · e-way bill ${x.ewayBillNo} (mock)` : ''}${x.taxInvoiceNumber ? ` · ${x.taxInvoiceNumber}` : ''}`); if (r) onDone(); }}>
      <Card className="bg-card2 p-4 text-sm">Consignment value ≈ <b>{est === null ? '…' : inr(est)}</b> at weighted-average cost. {needEway ? <b className="text-cherry">E-way bill required (above ₹50,000).</b> : 'No e-way bill needed.'}</Card>
      <Field label={`Vehicle number${needEway ? '' : ' (optional)'}`} required={needEway}><Input value={veh} onChange={(e) => setVeh(e.target.value.toUpperCase())} placeholder="MH12AB1234" /></Field>
      <div className="flex justify-end"><Button type="submit" loading={busy} disabled={needEway && !veh}>Dispatch</Button></div>
    </form>
  );
}
function ReceiveForm({ t, onDone }: { t: Doc; onDone: () => void }) {
  const { run, busy } = useCommand(); const { name } = useSkus();
  const [st, setSt] = React.useState<Record<string, { rec: number; dmg: number }>>(Object.fromEntries((t.lines as Doc[]).map((l) => [l.skuId, { rec: l.qty, dmg: 0 }])));
  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-x-auto p-0"><table className="w-full text-sm"><thead className="bg-card2 text-left text-xs text-soft"><tr><th className="p-3">Item</th><th className="p-3 text-right">Dispatched</th><th className="p-3 text-right">Received</th><th className="p-3 text-right">Damaged</th><th className="p-3">Variance</th></tr></thead>
        <tbody>{(t.lines as Doc[]).map((l) => { const s = st[l.skuId]!; const short = l.qty - s.rec; return (
          <tr key={l.skuId} className="border-t border-line/60"><td className="p-3">{name(l.skuId)}</td><td className="num p-3">{l.qty}</td>
            <td className="p-3"><Input type="number" min={0} max={l.qty} className="num ml-auto w-24" aria-label={`Received ${l.skuId}`} value={s.rec} onChange={(e) => setSt({ ...st, [l.skuId]: { ...s, rec: Number(e.target.value) } })} /></td>
            <td className="p-3"><Input type="number" min={0} className="num ml-auto w-20" aria-label={`Damaged ${l.skuId}`} value={s.dmg} onChange={(e) => setSt({ ...st, [l.skuId]: { ...s, dmg: Number(e.target.value) } })} /></td>
            <td className="p-3 text-xs">{short > 0 && <Badge tone="butter">short {short}</Badge>} {s.dmg > 0 && <Badge tone="cherry">damaged {s.dmg}</Badge>} {!short && !s.dmg && <Badge tone="mint">ok</Badge>}</td></tr>); })}</tbody></table></Card>
      <div className="flex justify-end"><Button loading={busy} disabled={(t.lines as Doc[]).some((l) => st[l.skuId]!.rec > l.qty || st[l.skuId]!.dmg > st[l.skuId]!.rec)} onClick={async () => { const r = await run('receiveTransfer', { transferId: t.id, lines: (t.lines as Doc[]).map((l) => ({ skuId: l.skuId, receivedQty: st[l.skuId]!.rec, damagedQty: st[l.skuId]!.dmg })) }, (x) => (x.variance ? 'Received with variance recorded' : 'Received in full')); if (r) onDone(); }}>Confirm receipt</Button></div>
    </div>
  );
}
function TransferDetail({ t }: { t: Doc }) {
  const { name } = useSkus();
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-2"><StatusBadge status={t.status} /><span className="text-soft">{t.fromName} → {t.toName}</span>{t.interState && <Badge tone="lavender">Inter-state</Badge>}</div>
      {t.taxInvoice && <Card className="p-4"><b>Tax invoice {t.taxInvoice.number}</b><p>Taxable {inr(t.taxInvoice.taxableValuePaise)} + IGST {inr(t.taxInvoice.igstPaise)} = {inr(t.taxInvoice.totalPaise)}</p><p className="text-xs text-soft">{t.taxInvoice.fromGstin} → {t.taxInvoice.toGstin}</p></Card>}
      {t.ewayBillNo && <Card className="p-4"><b>E-way bill {t.ewayBillNo}</b> <Badge tone="butter">mock GSP</Badge><p className="text-xs text-soft">Vehicle {t.vehicleNo} · value {inr(t.valuePaise)}</p></Card>}
      <Card className="overflow-x-auto p-0"><table className="w-full"><thead className="bg-card2 text-left text-xs text-soft"><tr><th className="p-3">Item</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Received</th><th className="p-3 text-right">Short</th><th className="p-3 text-right">Damaged</th><th className="p-3 text-right">Cost</th></tr></thead>
        <tbody>{(t.lines as Doc[]).map((l) => <tr key={l.skuId} className="border-t border-line/60"><td className="p-3">{name(l.skuId)}</td><td className="num p-3">{l.qty}</td><td className="num p-3">{l.receivedQty ?? '—'}</td><td className="num p-3">{l.shortQty ?? '—'}</td><td className="num p-3">{l.damagedQty ?? '—'}</td><td className="num p-3">{l.valuePaise ? inr(l.valuePaise) : '—'}</td></tr>)}</tbody></table></Card>
      <p className="text-xs text-soft">Created {dateStr(t.createdAt)} by {t.createdByName}</p>
    </div>
  );
}
