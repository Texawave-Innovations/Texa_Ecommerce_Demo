'use client';
import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { History, Mail, MessageCircle, Pencil, Printer } from 'lucide-react';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Skeleton, Textarea } from '@texafashions/ui';
import { data } from '@/lib/data';
import { DecideButtons } from '@/components/scm/purchase';
import { DataTable, FlowTracker, LinesEditor, PageHead, StatusBadge, dateStr, esc, inr, minor, printHtml, useCommand, useDoc, useRows, useSkus, type LineState } from '@/components/scm/kit';
import { useSession } from '@/lib/stores';

type Doc = Record<string, any>;
export default function PoDetail() {
  const { id } = useParams<{ id: string }>();
  const po = useDoc('purchaseOrders', id); const role = useSession((s) => s.session!.claims.role);
  const grns = useRows('grns', { where: [['poId', '==', id]] }); const asns = useRows('asns', { where: [['poId', '==', id]] }); const invs = useRows('purchaseInvoices', { where: [['poId', '==', id]] });
  const log = useRows('messageLog', { where: [['refId', '==', id]] });
  const { run, busy } = useCommand(); const { name } = useSkus();
  const [amend, setAmend] = React.useState(false); const [versions, setVersions] = React.useState<Doc[] | null>(null);
  if (po === undefined) return <Skeleton className="h-96" />;
  if (!po) return <EmptyState title="PO not found" kind="bear" />;
  const lines = po.lines as Doc[]; const isBuyer = role === 'buyer' || role === 'super_admin';
  const open = lines.reduce((a, l) => a + Math.max(0, l.qty - l.receivedQty), 0);

  function print() {
    printHtml(po!.number, `<h1>Purchase Order ${esc(po!.number)}</h1><small>Texa Fashions Lifestyle India Pvt Ltd · v${po!.version}</small>
      <p><b>Vendor:</b> ${esc(po!.vendorName)} &nbsp; <b>Currency:</b> ${esc(po!.currency)} &nbsp; <b>Incoterm:</b> ${esc(po!.incoterm ?? '—')} &nbsp; <b>Terms:</b> ${po!.paymentTermsDays} days &nbsp; <b>Deliver by:</b> ${esc(dateStr(po!.expectedDate))}</p>
      <table><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr>
      ${lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}<br><small>${esc(l.skuId)}</small></td><td class="r">${l.qty}</td><td class="r">${esc(minor(po!.currency, l.unitPriceMinor))}</td><td class="r">${esc(minor(po!.currency, l.lineMinor))}</td></tr>`).join('')}
      <tr><td colspan="4" class="r"><b>Subtotal</b></td><td class="r"><b>${esc(minor(po!.currency, po!.subtotalMinor))}</b></td></tr></table>
      ${po!.type === 'domestic' ? `<p>GST (${po!.intraState ? 'CGST+SGST' : 'IGST'}): ${esc(inr(po!.taxPaise))} · <b>Total payable: ${esc(inr(po!.totalInrPaise))}</b></p>` : `<p>INR equivalent at ₹${(po!.fxRatePaisePerUnit / 100).toFixed(4)}/${esc(po!.currency)}: ${esc(inr(po!.subtotalInrPaise))}</p>`}
      <p><small>Status: ${esc(po!.status)} · System-generated document</small></p>`);
  }
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHead back={{ href: '/scm/purchase?tab=orders', label: 'Purchase orders' }} title={<>{po.number} <StatusBadge status={po.status} /></>}
        sub={`${po.vendorName} · ${po.type} · ${po.currency} · v${po.version}${po.isMsme ? ' · MSME vendor' : ''}`}
        actions={<>
          <DecideButtons collection="purchaseOrders" doc={po} />
          <Button size="sm" variant="outline" onClick={print}><Printer className="size-4" />Print / PDF</Button>
          {isBuyer && ['approved', 'sent', 'acknowledged'].includes(po.status) && <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run('sendPO', { poId: id, channel: 'email' }, 'E-mail queued (mock)')}><Mail className="size-4" />E-mail</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run('sendPO', { poId: id, channel: 'whatsapp' }, 'WhatsApp queued (mock)')}><MessageCircle className="size-4" />WhatsApp</Button></>}
          {isBuyer && !['received', 'closed', 'cancelled', 'rejected'].includes(po.status) && <Button size="sm" onClick={() => setAmend(true)}><Pencil className="size-4" />Amend</Button>}
        </>} />
      <FlowTracker flow={po.flow} />
      {po.status === 'pending_approval' && <Card className="bg-butter/40 p-4 text-sm">Waiting for <b>{String(po.approverRole).replace('_', ' ')}</b> approval — value {inr(po.totalInrPaise)}.</Card>}
      <Card className="p-0">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-card2 text-left text-xs text-soft"><tr><th className="p-3">Item</th><th className="p-3 text-right">Ordered</th><th className="p-3 text-right">Received</th><th className="p-3 text-right">Accepted</th><th className="p-3 text-right">Billed</th><th className="p-3 text-right">Unit price</th><th className="p-3 text-right">Amount</th></tr></thead>
          <tbody>{lines.map((l) => <tr key={l.skuId} className="border-t border-line/60"><td className="p-3">{l.name}<br /><span className="text-xs text-soft">{l.skuId}</span></td><td className="num p-3">{l.qty}</td><td className="num p-3">{l.receivedQty}</td><td className="num p-3">{l.acceptedQty}</td><td className="num p-3">{l.billedQty}</td><td className="num p-3">{minor(po.currency, l.unitPriceMinor)}</td><td className="num p-3">{minor(po.currency, l.lineMinor)}</td></tr>)}</tbody>
          <tfoot><tr className="border-t border-line"><td colSpan={6} className="p-3 text-right text-soft">Subtotal</td><td className="num p-3 font-medium">{minor(po.currency, po.subtotalMinor)}</td></tr>
            {po.currency !== 'INR' && <tr><td colSpan={6} className="p-3 text-right text-soft">≈ INR @ ₹{(po.fxRatePaisePerUnit / 100).toFixed(4)}</td><td className="num p-3">{inr(po.subtotalInrPaise)}</td></tr>}
            {po.type === 'domestic' && <tr><td colSpan={6} className="p-3 text-right text-soft">GST ({po.intraState ? 'CGST + SGST' : 'IGST'})</td><td className="num p-3">{inr(po.taxPaise)}</td></tr>}
            <tr><td colSpan={6} className="p-3 text-right font-medium">Total (INR)</td><td className="num p-3 font-display text-lg">{inr(po.totalInrPaise)}</td></tr></tfoot>
        </table></div>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Card><h3 className="font-medium">Terms</h3><dl className="mt-2 space-y-1 text-sm"><Row k="Incoterm" v={po.incoterm ?? '—'} /><Row k="Payment terms" v={`${po.paymentTermsDays} days`} /><Row k="Expected" v={dateStr(po.expectedDate)} /><Row k="Promised by vendor" v={dateStr(po.promisedDate)} /><Row k="Open units" v={String(open)} />{po.advancePaise ? <Row k="Advance paid" v={inr(po.advancePaise)} /> : null}</dl>
          {po.proforma && <p className="mt-3 text-xs">Proforma uploaded by {po.proforma.by} <ProformaLink path={po.proforma.path} /></p>}</Card>
        <Card className="md:col-span-2"><h3 className="font-medium">Delivery schedule</h3>
          {(po.schedule as Doc[])?.length ? <ul className="mt-2 space-y-1 text-sm">{(po.schedule as Doc[]).map((s, i) => <li key={i} className="flex justify-between"><span>{s.locationId} · {name(s.skuId)}</span><span className="num">{s.qty} by {dateStr(s.dueDate)}</span></li>)}</ul> : <p className="mt-2 text-sm text-soft">Single delivery to {po.locationId}.</p>}</Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><h3 className="mb-2 font-medium">Linked documents</h3>
          <ul className="space-y-1 text-sm">
            {po.prId && <li>Requisition · <span className="text-soft">{po.flow?.PR?.number}</span></li>}
            {asns?.map((a) => <li key={a.id}>ASN · {a.number} <StatusBadge status={a.status} /></li>)}
            {grns?.map((g) => <li key={g.id}>GRN · {g.number} <StatusBadge status={g.status} /></li>)}
            {invs?.map((i) => <li key={i.id}>Invoice · {i.invoiceNo} <StatusBadge status={i.status} /></li>)}
            {!asns?.length && !grns?.length && !invs?.length && <li className="text-soft">Nothing posted against this PO yet.</li>}
          </ul>
          <Link href="/scm/receiving" className="mt-3 inline-block text-sm text-cherry">Receiving →</Link></Card>
        <Card><div className="mb-2 flex items-center justify-between"><h3 className="font-medium">Versions & messages</h3>
          <Button size="sm" variant="ghost" onClick={async () => setVersions(await data().scm.listVersions(id))}><History className="size-4" />Load history</Button></div>
          {versions && (versions.length ? <ul className="space-y-1 text-sm">{versions.map((v) => <li key={v.id}>v{v.version} · {inr(v.totalInrPaise)} · <span className="text-soft">{v.amendReason}</span></li>)}</ul> : <p className="text-sm text-soft">No earlier versions.</p>)}
          {log?.map((m) => <p key={m.id} className="mt-2 text-xs text-soft">✉ {m.channel} → {m.to} <Badge tone="butter">mock</Badge></p>)}</Card>
      </div>
      <Dialog open={amend} onClose={() => setAmend(false)} title={`Amend ${po.number}`} wide><AmendForm po={po} onDone={() => setAmend(false)} /></Dialog>
    </div>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between"><dt className="text-soft">{k}</dt><dd>{v}</dd></div>;
function ProformaLink({ path }: { path: string }) {
  const [url, setUrl] = React.useState('');
  React.useEffect(() => { data().scm.fileUrl(path).then(setUrl).catch(() => setUrl('')); }, [path]);
  return url ? <a href={url} target="_blank" rel="noreferrer" className="text-cherry">open</a> : null;
}
function AmendForm({ po, onDone }: { po: Doc; onDone: () => void }) {
  const { run, busy } = useCommand();
  const [lines, setLines] = React.useState<LineState[]>((po.lines as Doc[]).map((l) => ({ skuId: l.skuId, qty: l.qty, price: l.unitPriceMinor / 100 })));
  const [reason, setReason] = React.useState(''); const [expected, setExpected] = React.useState(po.expectedDate ?? '');
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('amendPO', { poId: po.id, reason, expectedDate: expected || null, lines: lines.filter((l) => l.qty > 0).map((l) => ({ skuId: l.skuId, qty: l.qty, unitPriceMinor: Math.round((l.price ?? 0) * 100) })) }, (x) => `Now v${x.version}${x.status === 'pending_approval' ? ' — sent back for approval' : ''}`); if (r) onDone(); }}>
      <p className="text-sm text-soft">The previous version is kept in the PO’s version history. Raising the value above your authority sends it back for approval.</p>
      <LinesEditor lines={lines} setLines={setLines} withPrice currency={po.currency} />
      <Field label="Expected delivery"><Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
      <Field label="Reason for amendment" required><Textarea rows={2} className="font-sans text-sm" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="flex justify-end"><Button type="submit" loading={busy} disabled={reason.length < 3}>Save amendment</Button></div>
    </form>
  );
}
void DataTable;
