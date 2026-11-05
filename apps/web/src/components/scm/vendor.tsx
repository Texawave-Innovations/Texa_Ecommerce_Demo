'use client';
import * as React from 'react';
import { CheckCircle2, FileUp, Truck } from 'lucide-react';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Textarea } from '@texafashions/ui';
import { data } from '@/lib/data';
import { useSession } from '@/lib/stores';
import { DataTable, FieldRow, FlowTracker, StatusBadge, dateStr, minor, useCommand, useRows, useSkus } from './kit';

type Doc = Record<string, any>;
export function VendorPortal() {
  const claims = useSession((s) => s.session!.claims); const vendorId = claims.vendorId ?? '__none__';
  const pos = useRows('purchaseOrders', { where: [['vendorId', '==', vendorId]] }); const asns = useRows('asns', { where: [['vendorId', '==', vendorId]] });
  const [sel, setSel] = React.useState<string | null>(null); const po = pos?.find((p) => p.id === sel) ?? null;
  const needAck = (pos ?? []).filter((p) => ['approved', 'sent'].includes(p.status)).length;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <header><h1 className="font-display text-3xl">Vendor portal</h1><p className="text-sm text-soft">Your purchase orders from Texa Fashions — acknowledge, share a proforma and notify shipments.</p></header>
      <div className="grid gap-3 sm:grid-cols-3"><Card className={needAck ? 'bg-butter/40' : ''}><p className="text-xs text-soft">Awaiting your acknowledgement</p><p className="font-display text-3xl">{needAck}</p></Card>
        <Card><p className="text-xs text-soft">Open orders</p><p className="font-display text-3xl">{(pos ?? []).filter((p) => !['received', 'closed', 'cancelled', 'rejected'].includes(p.status)).length}</p></Card>
        <Card><p className="text-xs text-soft">Shipments notified</p><p className="font-display text-3xl">{asns?.length ?? 0}</p></Card></div>
      <DataTable rows={pos} onRow={(r) => setSel(r.id)} cols={[
        { key: 'number', header: 'PO', cell: (r) => <b className="font-medium">{r.number}</b> }, { key: 'currency', header: 'Currency' },
        { key: 'subtotalMinor', header: 'Value', align: 'right', cell: (r) => minor(r.currency, r.subtotalMinor) }, { key: 'expectedDate', header: 'Expected', cell: (r) => dateStr(r.expectedDate) },
        { key: 'promisedDate', header: 'You promised', cell: (r) => dateStr(r.promisedDate) }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        { key: 'act', header: '', cell: (r) => (['approved', 'sent'].includes(r.status) ? <Badge tone="butter">action needed</Badge> : null) },
      ]} empty={<EmptyState kind="bunny" title="No purchase orders yet" />} />
      <h2 className="font-display text-xl">Your shipments</h2>
      <DataTable rows={asns} cols={[{ key: 'number', header: 'ASN', cell: (r) => <b className="font-medium">{r.number}</b> }, { key: 'poNumber', header: 'PO' }, { key: 'eta', header: 'ETA', cell: (r) => dateStr(r.eta) }, { key: 'awb', header: 'AWB / container', cell: (r) => r.awb ?? r.containerNo ?? '—' }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }]} empty={<EmptyState kind="capybara" title="No shipments" />} />
      <Dialog open={!!po} onClose={() => setSel(null)} title={po?.number ?? ''} wide>{po && <PoPanel po={po} onClose={() => setSel(null)} />}</Dialog>
    </div>
  );
}
function PoPanel({ po, onClose }: { po: Doc; onClose: () => void }) {
  const { run, busy } = useCommand(); const { name } = useSkus(); const vendorId = useSession((s) => s.session!.claims.vendorId);
  const [promised, setPromised] = React.useState(po.promisedDate ?? po.expectedDate ?? ''); const [note, setNote] = React.useState('');
  const [asnOpen, setAsnOpen] = React.useState(false); const [up, setUp] = React.useState(false);
  const canAck = ['approved', 'sent'].includes(po.status); const canShip = ['approved', 'sent', 'acknowledged', 'partially_received'].includes(po.status);
  async function proforma(f?: File) {
    if (!f) return; setUp(true);
    try { const path = await data().scm.uploadFile(`vendor-portal/${vendorId}/proforma/${po.number.replace(/\//g, '-')}-${Date.now()}-${f.name}`, f); await run('recordProforma', { poId: po.id, storagePath: path }, 'Proforma shared with Texa Fashions'); }
    finally { setUp(false); }
  }
  return (
    <div className="flex flex-col gap-4">
      <FlowTracker flow={po.flow} />
      <Card className="overflow-x-auto p-0"><table className="w-full text-sm"><thead className="bg-card2 text-left text-xs text-soft"><tr><th className="p-3">Item</th><th className="p-3 text-right">Ordered</th><th className="p-3 text-right">Received</th><th className="p-3 text-right">Unit price</th></tr></thead>
        <tbody>{(po.lines as Doc[]).map((l) => <tr key={l.skuId} className="border-t border-line/60"><td className="p-3">{name(l.skuId)}</td><td className="num p-3">{l.qty}</td><td className="num p-3">{l.receivedQty}</td><td className="num p-3">{minor(po.currency, l.unitPriceMinor)}</td></tr>)}</tbody></table></Card>
      {canAck && (
        <Card className="flex flex-col gap-3 bg-butter/30 p-4"><h3 className="font-medium">Acknowledge this order</h3>
          <FieldRow><Field label="Promised delivery date"><Input type="date" value={promised} onChange={(e) => setPromised(e.target.value)} /></Field><Field label="Note"><Textarea rows={1} className="font-sans text-sm" value={note} onChange={(e) => setNote(e.target.value)} /></Field></FieldRow>
          <Button className="self-end" loading={busy} onClick={async () => { if (await run('ackPO', { poId: po.id, promisedDate: promised || null, note: note || null }, 'Order acknowledged')) onClose(); }}><CheckCircle2 className="size-4" />Acknowledge</Button></Card>)}
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-pill bg-lavender/70 px-5 py-2 text-sm hover:bg-lavender"><FileUp className="size-4" />{up ? 'Uploading…' : 'Upload proforma invoice'}<input type="file" hidden accept="application/pdf,image/*" onChange={(e) => proforma(e.target.files?.[0])} /></label>
        {canShip && <Button variant="outline" onClick={() => setAsnOpen(true)}><Truck className="size-4" />Create shipment notice (ASN)</Button>}
        {po.proforma && <Badge tone="mint">Proforma on file</Badge>}
      </div>
      <Dialog open={asnOpen} onClose={() => setAsnOpen(false)} title={`Advance shipment notice — ${po.number}`} wide><AsnForm po={po} onDone={() => { setAsnOpen(false); onClose(); }} /></Dialog>
    </div>
  );
}
function AsnForm({ po, onDone }: { po: Doc; onDone: () => void }) {
  const { run, busy } = useCommand(); const { name } = useSkus();
  const open = (po.lines as Doc[]).filter((l) => l.qty - l.receivedQty > 0);
  const [qty, setQty] = React.useState<Record<string, number>>(Object.fromEntries(open.map((l) => [l.skuId, l.qty - l.receivedQty])));
  const [eta, setEta] = React.useState(''); const [awb, setAwb] = React.useState(''); const [cont, setCont] = React.useState(''); const [boxes, setBoxes] = React.useState(0);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('createASN', { poId: po.id, eta, awb: awb || null, containerNo: cont || null, boxes: boxes || null, lines: open.filter((l) => (qty[l.skuId] ?? 0) > 0).map((l) => ({ skuId: l.skuId, qty: qty[l.skuId]! })) }, (x) => `${x.number} sent to the warehouse`); if (r) onDone(); }}>
      <FieldRow><Field label="Expected arrival" required><Input type="date" value={eta} onChange={(e) => setEta(e.target.value)} /></Field><Field label="AWB / BL number"><Input value={awb} onChange={(e) => setAwb(e.target.value)} /></Field><Field label="Container no."><Input value={cont} onChange={(e) => setCont(e.target.value)} /></Field><Field label="Boxes / cartons"><Input type="number" min={0} className="num" value={boxes} onChange={(e) => setBoxes(Number(e.target.value))} /></Field></FieldRow>
      {open.map((l) => <div key={l.skuId} className="grid grid-cols-[1fr_auto_110px] items-center gap-3"><span className="truncate text-sm">{name(l.skuId)}</span><span className="text-xs text-soft">open {l.qty - l.receivedQty}</span><Input type="number" min={0} max={l.qty - l.receivedQty} className="num" aria-label={`Ship ${l.skuId}`} value={qty[l.skuId]} onChange={(e) => setQty({ ...qty, [l.skuId]: Number(e.target.value) })} /></div>)}
      <div className="flex justify-end"><Button type="submit" loading={busy} disabled={!eta || !Object.values(qty).some((q) => (q ?? 0) > 0)}>Send ASN</Button></div>
    </form>
  );
}
