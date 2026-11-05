'use client';
import * as React from 'react';
import JsBarcode from 'jsbarcode';
import { Camera, Plus, ScanLine, Printer } from 'lucide-react';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Select, SlideOver, toast } from '@texafashions/ui';
import { data } from '@/lib/data';
import { useSession } from '@/lib/stores';
import { DataTable, FieldRow, StatusBadge, dateStr, esc, inr, printHtml, useCommand, useMaster, useRows, useSkus } from './kit';

type Doc = Record<string, any>;
const RECEIVABLE = ['approved', 'sent', 'acknowledged', 'partially_received'];
export const canReceive = () => ['warehouse_manager', 'super_admin'].includes(useSession.getState().session!.claims.role);

// ───────────────────────── Gate entry
export function GateTab() {
  const rows = useRows('gateEntries'); const [form, setForm] = React.useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{canReceive() && <Button size="sm" onClick={() => setForm(true)}><Plus className="size-4" />Log vehicle arrival</Button>}</div>
      <DataTable rows={rows} cols={[
        { key: 'number', header: 'Gate no.', cell: (r) => <b className="font-medium">{r.number}</b> }, { key: 'vendorName', header: 'Vendor' }, { key: 'poNumber', header: 'PO' },
        { key: 'vehicleNo', header: 'Vehicle' }, { key: 'driverName', header: 'Driver' }, { key: 'arrivedAt', header: 'Arrived', cell: (r) => dateStr(r.arrivedAt) }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]} empty={<EmptyState kind="bunny" title="No vehicles logged" />} />
      <Dialog open={form} onClose={() => setForm(false)} title="Gate entry"><GateForm onDone={() => setForm(false)} /></Dialog>
    </div>
  );
}
function GateForm({ onDone }: { onDone: () => void }) {
  const pos = useRows('purchaseOrders'); const { run, busy } = useCommand();
  const open = (pos ?? []).filter((p) => RECEIVABLE.includes(p.status));
  const [f, setF] = React.useState({ poId: '', vehicleNo: '', driverName: '', driverPhone: '', lrNo: '', invoiceNo: '' });
  const po = open.find((p) => p.id === f.poId); const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('createGateEntry', { poId: f.poId, vendorId: po!.vendorId, vehicleNo: f.vehicleNo, driverName: f.driverName, driverPhone: f.driverPhone || null, lrNo: f.lrNo || null, invoiceNo: f.invoiceNo || null, locationId: 'WH-CENTRAL' }, (x) => `${x.number} logged`); if (r) onDone(); }}>
      <Field label="Purchase order" required><Select value={f.poId} onChange={(e) => set('poId', e.target.value)}><option value="">Select…</option>{open.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.vendorName}</option>)}</Select></Field>
      <FieldRow>
        <Field label="Vehicle no." required><Input value={f.vehicleNo} onChange={(e) => set('vehicleNo', e.target.value.toUpperCase())} placeholder="MH12AB1234" /></Field>
        <Field label="Driver" required><Input value={f.driverName} onChange={(e) => set('driverName', e.target.value)} /></Field>
        <Field label="Driver phone"><Input value={f.driverPhone} onChange={(e) => set('driverPhone', e.target.value)} /></Field>
        <Field label="LR / AWB no."><Input value={f.lrNo} onChange={(e) => set('lrNo', e.target.value)} /></Field>
        <Field label="Vendor invoice / challan no."><Input value={f.invoiceNo} onChange={(e) => set('invoiceNo', e.target.value)} /></Field>
      </FieldRow>
      <div className="flex justify-end"><Button type="submit" loading={busy} disabled={!po || !f.vehicleNo || !f.driverName}>Log entry</Button></div>
    </form>
  );
}

// ───────────────────────── GRN with barcode scanning
export function GrnTab() {
  const rows = useRows('grns'); const [form, setForm] = React.useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{canReceive() && <Button size="sm" onClick={() => setForm(true)}><ScanLine className="size-4" />New goods receipt</Button>}</div>
      <DataTable rows={rows} cols={[
        { key: 'number', header: 'GRN', cell: (r) => <b className="font-medium">{r.number}</b> }, { key: 'poNumber', header: 'PO' }, { key: 'vendorName', header: 'Vendor' },
        { key: 'units', header: 'Received', align: 'right', cell: (r) => (r.lines as Doc[]).reduce((a, l) => a + l.receivedQty, 0) },
        { key: 'variance', header: 'Variance', cell: (r) => (r.hasVariance ? <Badge tone="butter">short / damaged / excess</Badge> : <Badge tone="mint">clean</Badge>) },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'createdAt', header: 'Date', cell: (r) => dateStr(r.createdAt) },
      ]} empty={<EmptyState kind="capybara" title="No goods received yet" />} />
      <SlideOver open={form} onClose={() => setForm(false)} width={720} title="Goods receipt note (GRN)"><GrnForm onDone={() => setForm(false)} /></SlideOver>
    </div>
  );
}
interface RecvLine { skuId: string; name: string; barcode: string; open: number; expected: number; received: number; damaged: number }
function GrnForm({ onDone }: { onDone: () => void }) {
  const pos = useRows('purchaseOrders'); const gates = useRows('gateEntries', { where: [['status', '==', 'at_gate']] }); const asns = useRows('asns', { where: [['status', '==', 'in_transit']] });
  const { map } = useSkus(); const { run, busy } = useCommand();
  const open = (pos ?? []).filter((p) => RECEIVABLE.includes(p.status));
  const [poId, setPoId] = React.useState(''); const [gateId, setGate] = React.useState(''); const [lines, setLines] = React.useState<RecvLine[]>([]); const [scan, setScan] = React.useState(''); const [flash, setFlash] = React.useState<string | null>(null);
  const po = open.find((p) => p.id === poId); const asn = asns?.find((a) => a.poId === poId);
  React.useEffect(() => {
    if (!po) { setLines([]); return; }
    const asnQty = new Map(((asn?.lines ?? []) as Doc[]).map((l) => [l.skuId, l.qty as number]));
    setLines((po.lines as Doc[]).filter((l) => l.qty - l.receivedQty > 0).map((l) => { const o = l.qty - l.receivedQty; return { skuId: l.skuId, name: l.name, barcode: String(map.get(l.skuId)?.barcode ?? ''), open: o, expected: asn ? Math.min(o, asnQty.get(l.skuId) ?? 0) : o, received: 0, damaged: 0 }; }));
  }, [poId, asn?.id, map.size]);  
  const onScan = (e: React.FormEvent) => {
    e.preventDefault(); const code = scan.trim(); setScan('');
    if (!code) return;
    const i = lines.findIndex((l) => l.barcode === code || l.skuId === code);
    if (i < 0) { toast(`${code} is not on this PO`, 'err'); setFlash('err'); return; }
    setLines(lines.map((l, j) => (j === i ? { ...l, received: l.received + 1 } : l))); setFlash(lines[i]!.skuId);
    setTimeout(() => setFlash(null), 600);
  };
  const set = (i: number, patch: Partial<RecvLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + l.received, 0);
  return (
    <div className="flex flex-col gap-4">
      <FieldRow>
        <Field label="Purchase order" required><Select value={poId} onChange={(e) => setPoId(e.target.value)}><option value="">Select…</option>{open.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.vendorName}</option>)}</Select></Field>
        <Field label="Gate entry"><Select value={gateId} onChange={(e) => setGate(e.target.value)}><option value="">—</option>{(gates ?? []).filter((g) => g.poId === poId).map((g) => <option key={g.id} value={g.id}>{g.number} · {g.vehicleNo}</option>)}</Select></Field>
      </FieldRow>
      {asn && <Badge tone="sky" className="self-start">Checking against ASN {asn.number}</Badge>}
      {po && <>
        <form onSubmit={onScan} className="flex gap-2"><Input autoFocus value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Scan barcode (or type & press Enter)" aria-label="Scan barcode" className={flash === 'err' ? 'border-cherry' : ''} /><Button type="submit" variant="soft"><ScanLine className="size-4" />Scan</Button></form>
        <Card className="overflow-x-auto p-0"><table className="w-full text-sm">
          <thead className="bg-card2 text-left text-xs text-soft"><tr><th className="p-3">Item</th><th className="p-3 text-right">Expected</th><th className="p-3 text-right">Received</th><th className="p-3 text-right">Damaged</th><th className="p-3">Variance</th></tr></thead>
          <tbody>{lines.map((l, i) => {
            const short = Math.max(0, l.expected - l.received), excess = Math.max(0, l.received - l.open);
            return (
              <tr key={l.skuId} className={`border-t border-line/60 transition-colors ${flash === l.skuId ? 'bg-mint/60' : ''}`}>
                <td className="p-3">{l.name}<br /><span className="text-xs text-soft">{l.barcode || l.skuId}</span></td><td className="num p-3">{l.expected}</td>
                <td className="p-3"><Input type="number" min={0} value={l.received} aria-label={`Received ${l.skuId}`} className="num ml-auto w-24" onChange={(e) => set(i, { received: Math.max(0, Number(e.target.value)) })} /></td>
                <td className="p-3"><Input type="number" min={0} value={l.damaged} aria-label={`Damaged ${l.skuId}`} className="num ml-auto w-20" onChange={(e) => set(i, { damaged: Math.max(0, Number(e.target.value)) })} /></td>
                <td className="p-3 text-xs">{l.received === 0 ? <span className="text-soft">—</span> : <>{short > 0 && <Badge tone="butter">short {short}</Badge>} {excess > 0 && <Badge tone="blush">excess {excess}</Badge>} {l.damaged > 0 && <Badge tone="cherry">damaged {l.damaged}</Badge>} {!short && !excess && !l.damaged && <Badge tone="mint">ok</Badge>}</>}</td>
              </tr>);
          })}</tbody>
        </table></Card>
        <div className="flex items-center justify-between"><Button variant="ghost" size="sm" onClick={() => setLines(lines.map((l) => ({ ...l, received: l.expected })))}>Fill expected quantities</Button>
          <Button loading={busy} disabled={!total || lines.some((l) => l.damaged > l.received)} onClick={async () => { const r = await run('postGRN', { poId, gateEntryId: gateId || null, asnId: asn?.id ?? null, locationId: 'WH-CENTRAL', lines: lines.filter((l) => l.received > 0 || l.damaged > 0).map((l) => ({ skuId: l.skuId, receivedQty: l.received, damagedQty: l.damaged })) }, (x) => `${x.number} posted → ${x.status.replace('_', ' ')}`); if (r) onDone(); }}>Post GRN ({total} units)</Button></div>
      </>}
    </div>
  );
}

// ───────────────────────── QC with photos
export function QcTab() {
  const rows = useRows('qcInspections'); const [sel, setSel] = React.useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <DataTable rows={rows} onRow={(r) => (r.status === 'pending' || r.status === 'rework') && canReceive() && setSel(r.id)} cols={[
        { key: 'grnNumber', header: 'GRN', cell: (r) => <b className="font-medium">{r.grnNumber}</b> }, { key: 'poNumber', header: 'PO' },
        { key: 'status', header: 'QC status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'inspectedByName', header: 'Inspector', cell: (r) => r.inspectedByName ?? '—' },
        { key: 'act', header: '', cell: (r) => (r.status === 'pending' || r.status === 'rework') && canReceive() ? <Button size="sm">Inspect</Button> : null },
      ]} empty={<EmptyState kind="bear" title="Nothing awaiting QC" />} />
      <SlideOver open={!!sel} onClose={() => setSel(null)} width={720} title="Quality inspection">{sel && <QcForm grnId={sel} onDone={() => setSel(null)} />}</SlideOver>
    </div>
  );
}
function QcForm({ grnId, onDone }: { grnId: string; onDone: () => void }) {
  const [grn, setGrn] = React.useState<Doc | null>(null); const reasons = useMaster('reasonCodes'); const { run, busy } = useCommand();
  const [st, setSt] = React.useState<Record<string, { pass: number; reject: number; rework: number; reason: string; note: string; photos: { path: string; url: string }[] }>>({});
  const [up, setUp] = React.useState(false);
  React.useEffect(() => { data().scm.get('grns', grnId).then((g) => { setGrn(g); if (g) setSt(Object.fromEntries((g.lines as Doc[]).map((l) => [l.skuId, { pass: l.goodQty - l.acceptedQty - l.rejectedQty, reject: 0, rework: 0, reason: '', note: '', photos: [] }]))); }); }, [grnId]);
  if (!grn) return <p className="text-sm text-soft">Loading…</p>;
  const lines = (grn.lines as Doc[]).filter((l) => l.goodQty - l.acceptedQty - l.rejectedQty > 0);
  const upd = (id: string, p: Partial<(typeof st)[string]>) => setSt({ ...st, [id]: { ...st[id]!, ...p } });
  const valid = lines.every((l) => { const s = st[l.skuId]; return s && s.pass + s.reject + s.rework === l.goodQty - l.acceptedQty - l.rejectedQty && (s.reject === 0 || !!s.reason); });
  async function photo(skuId: string, files: FileList | null) {
    if (!files?.length) return; setUp(true);
    try { const added = []; for (const f of Array.from(files).slice(0, 3)) { const path = await data().scm.uploadFile(`scm/qc/${grnId}/${skuId}-${Date.now()}-${f.name}`, f); added.push({ path, url: URL.createObjectURL(f) }); } upd(skuId, { photos: [...st[skuId]!.photos, ...added] }); toast('Photo uploaded to Cloud Storage', 'ok'); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setUp(false); }
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-soft">{grn.number} · {grn.vendorName}. Every received unit must be passed, rejected or sent for rework.</p>
      {lines.map((l) => { const s = st[l.skuId]; if (!s) return null; const remaining = l.goodQty - l.acceptedQty - l.rejectedQty; const sum = s.pass + s.reject + s.rework;
        return (
          <Card key={l.skuId} className="p-4"><div className="flex justify-between"><b className="font-medium">{l.name}</b><span className="text-sm text-soft">{remaining} to inspect</span></div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Field label="Pass"><Input type="number" min={0} value={s.pass} className="num" aria-label={`Pass ${l.skuId}`} onChange={(e) => upd(l.skuId, { pass: Number(e.target.value) })} /></Field>
              <Field label="Reject"><Input type="number" min={0} value={s.reject} className="num" aria-label={`Reject ${l.skuId}`} onChange={(e) => upd(l.skuId, { reject: Number(e.target.value) })} /></Field>
              <Field label="Rework"><Input type="number" min={0} value={s.rework} className="num" aria-label={`Rework ${l.skuId}`} onChange={(e) => upd(l.skuId, { rework: Number(e.target.value) })} /></Field>
            </div>
            {sum !== remaining && <p role="alert" className="mt-2 text-xs text-cherry">Pass + reject + rework = {sum}; must equal {remaining}.</p>}
            {s.reject > 0 && <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Reason code" required><Select value={s.reason} aria-label={`Reason ${l.skuId}`} onChange={(e) => upd(l.skuId, { reason: e.target.value })}><option value="">Select…</option>{reasons.rows.filter((r) => r.context === 'qc_reject').map((r) => <option key={r.id} value={r.id}>{String(r.name)}</option>)}</Select></Field>
              <Field label="Defect note (auto-tagged)"><Input value={s.note} onChange={(e) => upd(l.skuId, { note: e.target.value })} placeholder="e.g. stitching loose" /></Field>
              <div className="sm:col-span-2 flex items-center gap-3"><label className="inline-flex cursor-pointer items-center gap-2 rounded-pill bg-blush/60 px-4 py-2 text-sm hover:bg-blush"><Camera className="size-4" />{up ? 'Uploading…' : 'Add photos'}<input type="file" accept="image/*" multiple hidden onChange={(e) => photo(l.skuId, e.target.files)} /></label>
                {s.photos.map((p) => <img key={p.path} src={p.url} alt="defect" className="size-12 rounded-xl border border-line object-cover" />)}</div>
            </div>}
          </Card>);
      })}
      <div className="flex justify-end"><Button loading={busy} disabled={!valid} onClick={async () => { const r = await run('postQC', { grnId, lines: lines.map((l) => { const s = st[l.skuId]!; return { skuId: l.skuId, passQty: s.pass, rejectQty: s.reject, reworkQty: s.rework, reasonCode: s.reject ? s.reason : null, defectNote: s.note || null, photoPaths: s.photos.map((p) => p.path) }; }) }, (x) => `QC ${x.status}${x.returnNumber ? ` · return ${x.returnNumber} drafted` : ''}`); if (r) onDone(); }}>Post inspection</Button></div>
    </div>
  );
}

// ───────────────────────── Putaway with label print
export function PutawayTab() {
  const rows = useRows('putawayTasks'); const bins = useMaster('bins'); const { run } = useCommand();
  const [pick, setPick] = React.useState<Record<string, string>>({});
  const open = (rows ?? []).filter((t) => t.status !== 'done');
  const done = (rows ?? []).filter((t) => t.status === 'done').length;
  function label(t: Doc, binId: string, qty: number) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    try { JsBarcode(el, String(t.barcode ?? t.skuId), { format: 'CODE128', height: 44, fontSize: 12, margin: 0 }); } catch { /* ignore */ }
    printHtml('Putaway label', `<div style="width:60mm;border:1px dashed #999;padding:3mm"><b>${esc(t.name)}</b><br><small>${esc(t.skuId)}</small>${el.outerHTML}<div style="font-size:20px;margin-top:2mm"><b>${esc(binId)}</b> · ${qty} pcs</div><small>${esc(t.grnNumber)}</small></div>`, 'svg{width:100%}');
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-soft">{open.length} task(s) waiting · {done} done</p>
      <DataTable rows={rows === null ? null : open} cols={[
        { key: 'name', header: 'Item', cell: (r) => <><b className="font-medium">{r.name}</b><br /><span className="text-xs text-soft">{r.grnNumber}</span></> }, { key: 'qty', header: 'To place', align: 'right', cell: (r) => r.qty - r.qtyDone },
        { key: 'bin', header: 'Bin', cell: (r) => <Select aria-label={`Bin for ${r.skuId}`} value={pick[r.id] ?? r.suggestedBinId ?? ''} onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })}>{!r.suggestedBinId && <option value="">Choose bin…</option>}{bins.rows.filter((b) => b.warehouseId === 'WH-CENTRAL' && !/^BIN-(QC|DMG)/.test(b.id)).map((b) => <option key={b.id} value={b.id}>{b.id}{b.id === r.suggestedBinId ? ' ★ suggested' : ''}</option>)}</Select> },
        { key: 'act', header: '', cell: (r) => { const bin = pick[r.id] ?? r.suggestedBinId ?? ''; return (
          <span className="flex justify-end gap-1"><Button size="sm" variant="ghost" aria-label="Print label" disabled={!bin} onClick={() => label(r, bin, r.qty - r.qtyDone)}><Printer className="size-4" /></Button>
            {canReceive() && <Button size="sm" disabled={!bin} onClick={async () => { const x = await run('postPutaway', { taskId: r.id, binId: bin }, 'Put away'); if (x?.label) label(r, bin, x.label.qty); }}>Put away</Button>}</span>); } },
      ]} empty={<EmptyState kind="capybara" title="All shelved!" hint="Putaway tasks appear after QC passes." />} />
    </div>
  );
}

// ───────────────────────── Purchase returns & debit notes
export function ReturnsTab() {
  const rets = useRows('purchaseReturns'); const dns = useRows('debitNotes'); const { run, busy } = useCommand(); const role = useSession((s) => s.session!.claims.role);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2"><h3 className="font-display text-lg">Purchase returns (auto-drafted from QC rejects)</h3>
        <DataTable rows={rets} cols={[
          { key: 'number', header: 'Return', cell: (r) => <b className="font-medium">{r.number}</b> }, { key: 'vendorName', header: 'Vendor' }, { key: 'grnNumber', header: 'GRN' },
          { key: 'units', header: 'Units', align: 'right', cell: (r) => (r.lines as Doc[]).reduce((a, l) => a + l.qty, 0) }, { key: 'defect', header: 'Defect', cell: (r) => [...new Set((r.lines as Doc[]).map((l) => l.defectTag))].join(', ') },
          { key: 'totalPaise', header: 'Value + GST', align: 'right', cell: (r) => inr(r.totalPaise) }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          { key: 'act', header: '', cell: (r) => r.status === 'draft' && ['warehouse_manager', 'cfo', 'super_admin'].includes(role) ? <Button size="sm" disabled={busy} onClick={() => run('postPurchaseReturn', { returnId: r.id }, (x) => `Dispatched · ${x.debitNoteNumber}`)}>Dispatch & issue DN</Button> : null },
        ]} empty={<EmptyState kind="bear" title="No returns" />} /></section>
      <section className="flex flex-col gap-2"><h3 className="font-display text-lg">Debit notes</h3>
        <DataTable rows={dns} cols={[
          { key: 'number', header: 'Debit note', cell: (r) => <b className="font-medium">{r.number ?? 'Draft'}</b> }, { key: 'vendorName', header: 'Vendor' }, { key: 'poNumber', header: 'PO' },
          { key: 'amountPaise', header: 'Amount', align: 'right', cell: (r) => inr(r.amountPaise) }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'applied', header: 'Netted in AP', cell: (r) => (r.applied ? 'Yes' : r.status === 'issued' ? 'Pending next bill' : '—') },
        ]} empty={<EmptyState kind="bunny" title="No debit notes" />} /></section>
    </div>
  );
}
