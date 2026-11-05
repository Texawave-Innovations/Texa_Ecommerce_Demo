'use client';
import * as React from 'react';
import { Banknote, FlaskConical, Upload } from 'lucide-react';
import { Badge, Button, Dialog, EmptyState, Field, Input, Kpi, StaggerGrid, Textarea } from '@texafashions/ui';
import { DataTable, PageHead, StatusBadge, Tabbed, inr, useCommand, useRows, useScope } from '../scm/kit';
import { OmsNav, dt, useRole, type Doc } from './shared';

export function ReturnsView() {
  const [tab, setTab] = React.useState<'rto' | 'cod'>('rto'); const role = useRole();
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHead title="Returns & COD" sub="Undelivered parcels come back through QC — never straight to sellable stock. Courier cash is reconciled by AWB." />
      <OmsNav current="/oms/returns" />
      <Tabbed value={tab} onChange={setTab} tabs={[{ value: 'rto', label: 'RTO → QC' }, ...(['super_admin', 'cfo', 'auditor', 'warehouse_manager'].includes(role) ? [{ value: 'cod' as const, label: 'COD remittance' }] : [])]} />
      {tab === 'rto' ? <Rto /> : <Cod />}
    </div>
  );
}

function Rto() {
  const scope = useScope(); const rows = useRows('rtoCases', { where: scope.where('locationId') }); const [dlg, setDlg] = React.useState<{ k: 'recv' | 'qc'; r: Doc } | null>(null);
  return (
    <>
      <DataTable rows={rows} empty={<EmptyState kind="bunny" title="No RTO parcels" />} cols={[
        { key: 'orderName', header: 'Order', cell: (r) => <span><b className="font-medium">{r.orderName}</b><span className="block text-xs text-soft">{r.awb} · {r.courier}</span></span> },
        { key: 'loc', header: 'Origin', cell: (r) => r.locationName }, { key: 'pay', header: 'Payment', cell: (r) => <Badge tone={r.paymentMode === 'cod' ? 'butter' : 'mint'}>{r.paymentMode === 'cod' ? 'COD' : 'Prepaid'}</Badge> },
        { key: 'val', header: 'Value', align: 'right', cell: (r) => inr(r.valuePaise) }, { key: 'reason', header: 'Reason', cell: (r) => r.reason ?? '—' },
        { key: 'cn', header: 'Credit note', cell: (r) => r.creditNoteNo ?? '—' },
        { key: 'status', header: 'Status', cell: (r) => <span className="flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.refundDuePaise > 0 && <Badge tone="blush">refund {inr(r.refundDuePaise)}</Badge>}{r.variance && <Badge tone="cherry">variance</Badge>}</span> },
        { key: 'act', header: '', cell: (r) => <span className="flex justify-end">{r.status === 'at_origin' && <Button size="sm" onClick={() => setDlg({ k: 'recv', r })}>Receive</Button>}{r.status === 'pending_qc' && <Button size="sm" onClick={() => setDlg({ k: 'qc', r })}>QC</Button>}</span> },
      ]} />
      <Dialog open={dlg?.k === 'recv'} onClose={() => setDlg(null)} title={`Receive RTO ${dlg?.r.awb ?? ''}`}>{dlg?.k === 'recv' && <ReceiveForm r={dlg.r} onDone={() => setDlg(null)} />}</Dialog>
      <Dialog open={dlg?.k === 'qc'} onClose={() => setDlg(null)} title={`QC ${dlg?.r.orderName ?? ''}`} wide>{dlg?.k === 'qc' && <QcForm r={dlg.r} onDone={() => setDlg(null)} />}</Dialog>
    </>
  );
}
function ReceiveForm({ r, onDone }: { r: Doc; onDone: () => void }) {
  const { run, busy } = useCommand(); const [scans, setScans] = React.useState('');
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const list = scans.split(/[\s,]+/).filter(Boolean); const x = await run('receiveRto', { shipmentId: r.id, scans: list.length ? list : null }, (z) => `Received into QC · credit note ${z.creditNoteNo}${z.variance ? ` · variance: ${z.variance}` : ''}`); if (x) onDone(); }}>
      <p className="text-sm">Expected: {(r.lines as Doc[]).map((l) => `${l.qty}× ${l.name}`).join(', ')}.</p>
      <Field label="Scan returned units (optional)" help="Leave empty to receive exactly what was shipped. Differences are recorded as a variance."><Textarea rows={3} value={scans} onChange={(e) => setScans(e.target.value)} placeholder="One barcode per unit" /></Field>
      <p className="text-xs text-soft">Units go to the <b>In QC</b> bucket. The sales invoice is reversed with a credit note; prepaid orders are flagged for refund.</p>
      <div className="flex justify-end"><Button type="submit" loading={busy}>Receive into QC</Button></div>
    </form>
  );
}
function QcForm({ r, onDone }: { r: Doc; onDone: () => void }) {
  const { run, busy } = useCommand(); const rec = r.received as { skuId: string; qty: number }[]; const names = new Map((r.lines as Doc[]).map((l) => [l.skuId, l.name]));
  const [bad, setBad] = React.useState<Record<string, number>>({});
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const x = await run('qcRto', { rtoId: r.id, lines: rec.map((l) => ({ skuId: l.skuId, good: l.qty - (bad[l.skuId] ?? 0), damaged: bad[l.skuId] ?? 0 })) }, (z) => `QC done: ${z.good} back to stock, ${z.damaged} damaged${z.writeOffPaise ? ` (write-off ${inr(z.writeOffPaise)})` : ''}`); if (x) onDone(); }}>
      <ul className="divide-y divide-line/60 rounded-2xl border border-line/60">{rec.map((l) => (
        <li key={l.skuId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span>{names.get(l.skuId) ?? l.skuId}<span className="block text-xs text-soft">{l.qty} received</span></span>
          <label className="flex items-center gap-2">Damaged<Input type="number" min={0} max={l.qty} className="!w-20 text-center" value={bad[l.skuId] ?? 0} onChange={(e) => setBad({ ...bad, [l.skuId]: Math.max(0, Math.min(l.qty, Number(e.target.value) || 0)) })} aria-label={`Damaged ${names.get(l.skuId)}`} /></label></li>))}</ul>
      <p className="text-xs text-soft">Good units return to sellable stock; damaged units move to the Damaged bucket and are written off at cost.</p>
      <div className="flex justify-end"><Button type="submit" loading={busy}>Finish QC</Button></div>
    </form>
  );
}

function Cod() {
  const role = useRole(); const open = useRows('shipments', { where: [['codStatus', 'in', ['with_courier', 'short_paid']]] }); const rem = useRows('codRemittances', {}); const { run, busy } = useCommand();
  const [imp, setImp] = React.useState(false); const [sel, setSel] = React.useState<Doc | null>(null); const fin = ['cfo', 'super_admin'].includes(role);
  const held = open?.filter((s) => s.codStatus === 'with_courier') ?? []; const disputed = open?.filter((s) => s.codStatus === 'short_paid') ?? [];
  const oldest = held.length ? Math.max(...held.map((s) => Math.floor((Date.now() - new Date(s.deliveredAt ?? Date.now()).getTime()) / 86_400_000))) : 0;
  return (
    <>
      <StaggerGrid className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Cash held by couriers" value={held.reduce((a, s) => a + s.codAmountPaise, 0) / 100} format={(n) => '₹' + Math.round(n).toLocaleString('en-IN')} tone="butter" hint={`${held.length} delivered parcel(s)`} />
        <Kpi label="Oldest unremitted" value={oldest} format={(n) => `${n} d`} tone={oldest >= 7 ? 'blush' : 'mint'} hint="since delivery" />
        <Kpi label="Disputed (short-paid)" value={disputed.length} tone="blush" hint={inr(disputed.reduce((a, s) => a + (s.codShortPaise ?? 0), 0))} />
        <Kpi label="Remittances imported" value={rem?.length ?? 0} tone="sky" />
      </StaggerGrid>
      {fin && <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={busy} onClick={() => run('simulateCodRemittance', { shortLines: 1 }, (x) => `Remittance ${x.status.replace('_', ' ')} · ${x.issues} issue(s) · suspense ${inr(x.suspensePaise)}`)}><FlaskConical className="size-4" />Simulate courier remittance</Button>
        <Button size="sm" variant="soft" onClick={() => setImp(true)}><Upload className="size-4" />Import remittance advice</Button></div>}
      <h2 className="font-display text-xl">Remittances</h2>
      <DataTable rows={rem} onRow={setSel} empty={<EmptyState kind="capybara" title="No remittances yet" />} cols={[
        { key: 'utr', header: 'UTR', cell: (r) => <span><b className="font-medium">{r.utr}</b><span className="block text-xs text-soft">{r.courier} · {r.remittedOn}</span></span> },
        { key: 'rem', header: 'Remitted', align: 'right', cell: (r) => inr(r.remittedPaise) }, { key: 'fee', header: 'Fees', align: 'right', cell: (r) => inr(r.feesPaise) }, { key: 'net', header: 'To bank', align: 'right', cell: (r) => inr(r.netBankPaise) },
        { key: 'short', header: 'Short', align: 'right', cell: (r) => (r.shortPaise ? <span className="text-cherry">{inr(r.shortPaise)}</span> : '—') }, { key: 'sus', header: 'Suspense', align: 'right', cell: (r) => (r.suspensePaise ? inr(r.suspensePaise) : '—') },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]} />
      <h2 className="font-display text-xl">Delivered COD parcels awaiting remittance</h2>
      <DataTable rows={open} empty={<EmptyState kind="bunny" title="All COD cash is accounted for" />} cols={[
        { key: 'awb', header: 'AWB', cell: (r) => <span><b className="font-medium">{r.awb}</b><span className="block text-xs text-soft">{r.orderName}</span></span> }, { key: 'courier', header: 'Courier' },
        { key: 'amt', header: 'COD', align: 'right', cell: (r) => inr(r.codAmountPaise) }, { key: 'del', header: 'Delivered', cell: (r) => dt(r.deliveredAt) }, { key: 'st', header: 'Cash status', cell: (r) => <StatusBadge status={r.codStatus} /> },
      ]} />
      <Dialog open={imp} onClose={() => setImp(false)} title="Import courier remittance" wide>{imp && <ImportForm onDone={() => setImp(false)} />}</Dialog>
      <Dialog open={!!sel} onClose={() => setSel(null)} title={`Remittance ${sel?.utr ?? ''}`} wide>{sel && (
        <div className="flex flex-col gap-3 text-sm"><p className="text-soft">Reconciled by AWB against delivered COD parcels. Journal posted: Dr bank + courier fees · Cr COD receivable · Cr suspense for unmatched cash.</p>
          <ul className="divide-y divide-line/60 rounded-2xl border border-line/60">{(sel.rows as Doc[]).map((x, i) => <li key={i} className="flex justify-between gap-3 px-3 py-2"><span>{x.awb}</span><span className="num">{inr(x.remittedPaise)} <span className="text-soft">vs {inr(x.expectedPaise)}</span></span><StatusBadge status={x.status === 'unknown_awb' ? 'rejected' : x.status === 'matched' ? 'matched' : 'hold'} /><span className="text-xs text-soft">{String(x.status).replace('_', ' ')}</span></li>)}</ul>
          {(sel.pendingAwbs as string[]).length > 0 && <p className="text-xs text-soft">{(sel.pendingAwbs as string[]).length} delivered parcel(s) not in this file yet (normal for weekly batches).</p>}</div>)}</Dialog>
    </>
  );
}
function ImportForm({ onDone }: { onDone: () => void }) {
  const { run, busy } = useCommand(); const [courier, setCourier] = React.useState('Delhivery'); const [utr, setUtr] = React.useState(''); const [fees, setFees] = React.useState('0'); const [text, setText] = React.useState('');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [awb, amt] = l.split(/[,\s]+/); return { awb: awb ?? '', amountPaise: Math.round(Number(amt) * 100) }; });
  const bad = lines.some((l) => !l.awb || !Number.isFinite(l.amountPaise));
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const x = await run('importCodRemittance', { courier, utr, remittedOn: new Date().toISOString().slice(0, 10), lines, feesPaise: Math.round(Number(fees) * 100) }, (z) => `Imported — ${z.status.replace('_', ' ')}`); if (x) onDone(); }}>
      <div className="grid gap-3 sm:grid-cols-3"><Field label="Courier"><Input value={courier} onChange={(e) => setCourier(e.target.value)} required /></Field><Field label="UTR / reference"><Input value={utr} onChange={(e) => setUtr(e.target.value)} required minLength={4} /></Field><Field label="Fees deducted (₹)"><Input type="number" min={0} value={fees} onChange={(e) => setFees(e.target.value)} /></Field></div>
      <Field label="AWB, amount (₹) — one per line" help="At most 200 lines per file."><Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={'SR12345678901, 899\nSR10987654321, 1250.50'} /></Field>
      <div className="flex items-center justify-between"><span className="text-xs text-soft">{lines.length} line(s)</span><Button type="submit" loading={busy} disabled={!lines.length || bad}><Banknote className="size-4" />Reconcile & post</Button></div>
    </form>
  );
}
