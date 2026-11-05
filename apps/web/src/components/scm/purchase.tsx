'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, FileText, Plus, X } from 'lucide-react';
import { Button, Card, Dialog, EmptyState, Field, Input, Select, SlideOver, Textarea } from '@texafashions/ui';
import { mayApprove, importDuty, toInrPaise } from '@texafashions/domain';
import { CURRENCIES, type Currency } from '@texafashions/types';
import { data } from '@/lib/data';
import { useSession } from '@/lib/stores';
import { DataTable, FieldRow, LinesEditor, StatusBadge, dateStr, inr, minor, useCommand, useLocations, useMaster, useRows, useScope, useSkus, type LineState } from './kit';

type Doc = Record<string, any>;

/** Can the signed-in user approve this pending doc (role, limit, maker-checker)? Mirrors the server rule. */
export function useCanDecide() {
  const s = useSession((x) => x.session!);
  return (d: Doc) => d.status === 'pending_approval' && mayApprove({ uid: s.uid, role: s.claims.role, approvalLimitPaise: s.claims.approvalLimitPaise }, d.requestedBy ?? d.createdBy, d.approverRole, d.totalPaise ?? d.totalInrPaise ?? d.amountPaise ?? d.valuePaise ?? 0) === null;
}
export function DecideButtons({ collection, doc }: { collection: 'purchaseRequisitions' | 'purchaseOrders' | 'paymentVouchers' | 'adjustments'; doc: Doc }) {
  const can = useCanDecide(); const { run, busy } = useCommand();
  if (doc.status !== 'pending_approval') return null;
  const own = useSession.getState().session!.uid === (doc.requestedBy ?? doc.createdBy);
  if (!can(doc)) return <span className="text-xs text-soft" title={`Needs ${doc.approverRole}`}>{own ? 'Awaiting another approver' : `Needs ${String(doc.approverRole).replace('_', ' ')}`}</span>;
  return (
    <span className="flex gap-1">
      <Button size="sm" variant="ghost" disabled={busy} onClick={(e) => { e.stopPropagation(); run('decideDocument', { collection, id: doc.id, approve: false }, 'Rejected'); }} aria-label="Reject"><X className="size-4" /></Button>
      <Button size="sm" disabled={busy} onClick={(e) => { e.stopPropagation(); run('decideDocument', { collection, id: doc.id, approve: true }, (r) => `Approved → ${r.status}`); }}><Check className="size-4" />Approve</Button>
    </span>
  );
}

// ───────────────────────── Requisitions
export function RequisitionsTab() {
  const scope = useScope(); const router = useRouter();
  const rows = useRows('purchaseRequisitions', { where: scope.where('storeId') });
  const [form, setForm] = React.useState(false);
  const role = scope.claims.role;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{['buyer', 'store_manager', 'warehouse_manager', 'cfo', 'super_admin'].includes(role) && <Button size="sm" onClick={() => setForm(true)}><Plus className="size-4" />New requisition</Button>}</div>
      <DataTable rows={rows} cols={[
        { key: 'number', header: 'PR no.', cell: (r) => <b className="font-medium">{r.number}</b> },
        { key: 'storeId', header: 'For' }, { key: 'lines', header: 'Lines', align: 'right', cell: (r) => r.lines?.length },
        { key: 'totalPaise', header: 'Est. value', align: 'right', cell: (r) => inr(r.totalPaise) },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        { key: 'requestedByName', header: 'Requested by' },
        { key: 'act', header: '', cell: (r) => (
          <span className="flex items-center justify-end gap-1">
            <DecideButtons collection="purchaseRequisitions" doc={r} />
            {r.status === 'approved' && role === 'buyer' && <><Button size="sm" variant="outline" onClick={() => router.push(`/scm/purchase?tab=rfqs&pr=${r.id}`)}>RFQ</Button><Button size="sm" variant="soft" onClick={() => router.push(`/scm/purchase?tab=orders&pr=${r.id}`)}>PO</Button></>}
          </span>) },
      ]} empty={<EmptyState kind="capybara" title="No requisitions" hint="Create one, or convert replenishment suggestions." />} />
      <SlideOver open={form} onClose={() => setForm(false)} width={560} title="New purchase requisition / store indent"><PRForm onDone={() => setForm(false)} /></SlideOver>
    </div>
  );
}
export function PRForm({ onDone, initial }: { onDone: () => void; initial?: { storeId?: string; lines?: LineState[] } }) {
  const locs = useLocations(); const scope = useScope(); const { run, busy } = useCommand();
  const mine = locs.filter((l) => scope.all || scope.storeIds.includes(l.id));
  const [storeId, setStore] = React.useState(initial?.storeId ?? '');
  const [lines, setLines] = React.useState<LineState[]>(initial?.lines ?? []);
  const [needed, setNeeded] = React.useState(''); const [notes, setNotes] = React.useState('');
  React.useEffect(() => { if (!storeId && mine[0]) setStore(mine[0].id); }, [mine.length]);  
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('createPR', { storeId, lines: lines.filter((l) => l.qty > 0).map((l) => ({ skuId: l.skuId, qty: l.qty })), neededBy: needed || null, notes: notes || null }, (x) => `${x.number} → ${x.status.replace('_', ' ')}${x.status === 'pending_approval' ? ` (needs ${x.approverRole})` : ''}`); if (r) onDone(); }}>
      <FieldRow>
        <Field label="For location" required><Select value={storeId} onChange={(e) => setStore(e.target.value)}>{mine.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Needed by"><Input type="date" value={needed} onChange={(e) => setNeeded(e.target.value)} /></Field>
      </FieldRow>
      <Field label="Items"><LinesEditor lines={lines} setLines={setLines} /></Field>
      <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="font-sans text-sm" /></Field>
      <div className="flex justify-end"><Button type="submit" loading={busy} disabled={!lines.length || !storeId}>Submit requisition</Button></div>
    </form>
  );
}

// ───────────────────────── RFQs
export function RfqsTab({ prId }: { prId?: string }) {
  const rows = useRows('rfqs'); const router = useRouter();
  const [form, setForm] = React.useState(!!prId);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end"><Button size="sm" onClick={() => setForm(true)}><Plus className="size-4" />New RFQ</Button></div>
      <DataTable rows={rows} onRow={(r) => router.push(`/scm/purchase/rfqs/${r.id}`)} cols={[
        { key: 'number', header: 'RFQ no.', cell: (r) => <b className="font-medium">{r.number}</b> }, { key: 'prNumber', header: 'From PR' },
        { key: 'vendors', header: 'Vendors', align: 'right', cell: (r) => r.vendorIds?.length }, { key: 'lines', header: 'Lines', align: 'right', cell: (r) => r.lines?.length },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]} empty={<EmptyState kind="bunny" title="No RFQs" hint="Raise one from an approved requisition." />} />
      <Dialog open={form} onClose={() => setForm(false)} title="Request for quotation"><RfqForm prId={prId} onDone={(id) => { setForm(false); router.push(`/scm/purchase/rfqs/${id}`); }} /></Dialog>
    </div>
  );
}
function RfqForm({ prId, onDone }: { prId?: string; onDone: (id: string) => void }) {
  const prs = useRows('purchaseRequisitions', { where: [['status', '==', 'approved']] });
  const vendors = useMaster('vendors'); const { run, busy } = useCommand();
  const [pr, setPr] = React.useState(prId ?? ''); const [picked, setPicked] = React.useState<string[]>([]);
  React.useEffect(() => { if (!pr && prs?.[0]) setPr(prs[0].id); }, [prs]);  
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('createRFQ', { prId: pr, vendorIds: picked }, (x) => `${x.number} created`); if (r) onDone(r.id); }}>
      <Field label="Approved requisition" required><Select value={pr} onChange={(e) => setPr(e.target.value)}>{(prs ?? []).map((p) => <option key={p.id} value={p.id}>{p.number} · {p.lines?.length} lines · {inr(p.totalPaise)}</option>)}</Select></Field>
      <Field label="Invite vendors (1–8)" required>
        <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-2xl border border-line p-2 sm:grid-cols-2">
          {vendors.rows.map((v) => <label key={v.id} className="flex items-center gap-2 rounded-xl px-2 py-1 text-sm hover:bg-card2"><input type="checkbox" className="accent-[var(--cherry)]" checked={picked.includes(v.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, v.id].slice(0, 8) : picked.filter((x) => x !== v.id))} />{String(v.name)} <span className="text-xs text-soft">{String(v.currency)}</span></label>)}
        </div>
      </Field>
      <div className="flex justify-end"><Button type="submit" loading={busy} disabled={!pr || !picked.length}>Send RFQ to {picked.length || '…'} vendors</Button></div>
    </form>
  );
}

// ───────────────────────── Purchase orders
export function OrdersTab({ prId }: { prId?: string }) {
  const rows = useRows('purchaseOrders'); const router = useRouter(); const role = useSession((s) => s.session!.claims.role);
  const [form, setForm] = React.useState(!!prId);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{(role === 'buyer' || role === 'super_admin') && <Button size="sm" onClick={() => setForm(true)}><Plus className="size-4" />New purchase order</Button>}</div>
      <DataTable rows={rows} onRow={(r) => router.push(`/scm/purchase/orders/${r.id}`)} cols={[
        { key: 'number', header: 'PO no.', cell: (r) => <b className="font-medium">{r.number}</b> }, { key: 'vendorName', header: 'Vendor' },
        { key: 'type', header: 'Type', cell: (r) => <span className="capitalize">{r.type} · {r.currency}</span> },
        { key: 'totalInrPaise', header: 'Value (INR)', align: 'right', cell: (r) => inr(r.totalInrPaise) },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'v', header: 'Ver.', align: 'right', cell: (r) => `v${r.version}` },
        { key: 'act', header: '', cell: (r) => <DecideButtons collection="purchaseOrders" doc={r} /> },
      ]} empty={<EmptyState kind="capybara" title="No purchase orders" />} />
      <SlideOver open={form} onClose={() => setForm(false)} width={680} title="New purchase order"><POForm prId={prId} onDone={(id) => { setForm(false); router.push(`/scm/purchase/orders/${id}`); }} /></SlideOver>
    </div>
  );
}
export function POForm({ prId, onDone }: { prId?: string; onDone: (id: string) => void }) {
  const vendors = useMaster('vendors'); const fx = useMaster('fxRates'); const { skus, map } = useSkus(); const locs = useLocations(); const { run, busy } = useCommand();
  const [vendorId, setVendor] = React.useState(''); const [currency, setCurrency] = React.useState<Currency>('INR');
  const [lines, setLines] = React.useState<LineState[]>([]); const [incoterm, setIncoterm] = React.useState(''); const [terms, setTerms] = React.useState(30);
  const [expected, setExpected] = React.useState(''); const [notes, setNotes] = React.useState('');
  const [sched, setSched] = React.useState<{ locationId: string; skuId: string; qty: number; dueDate: string }[]>([]);
  const rate = currency === 'INR' ? 100 : Number(fx.map.get(`FX-${currency}`)?.ratePaisePerUnit ?? 0);
  const v = vendors.map.get(vendorId);
  React.useEffect(() => { if (v) { setCurrency(String(v.currency) as Currency); setIncoterm(String(v.incoterm ?? '')); setTerms(Number(v.paymentTermsDays ?? 30)); } }, [vendorId]);  
  // prefill from PR
  React.useEffect(() => {
    if (!prId || !skus.length) return;
    (async () => { const pr = await data().scm.get('purchaseRequisitions', prId); if (pr) setLines((pr.lines as Doc[]).map((l) => ({ skuId: l.skuId, qty: l.qty, price: 0 }))); })();
  }, [prId, skus.length]);
  // default price: SKU cost converted into the PO currency
  const defaultPrice = (id: string) => { const cost = Number(map.get(id)?.costPaise ?? 0) / 100; return currency === 'INR' || !rate ? cost : Math.round((cost / (rate / 100)) * 100) / 100; };
  React.useEffect(() => { setLines((ls) => ls.map((l) => (l.price ? l : { ...l, price: defaultPrice(l.skuId) }))); }, [currency, rate, skus.length, lines.length]);  
  const totalMinor = lines.reduce((a, l) => a + l.qty * Math.round((l.price ?? 0) * 100), 0);
  const inrTotal = toInrPaise(totalMinor, rate || 100);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run('createPO', {
      vendorId, type: currency === 'INR' ? 'domestic' : 'import', currency, incoterm: incoterm || null, paymentTermsDays: terms, expectedDate: expected || null, prId: prId ?? null, notes: notes || null,
      lines: lines.map((l) => ({ skuId: l.skuId, qty: l.qty, unitPriceMinor: Math.round((l.price ?? 0) * 100) })), schedule: sched.filter((s) => s.qty > 0 && s.dueDate),
    }, (x) => `${x.number} → ${x.status.replace('_', ' ')}${x.status === 'pending_approval' ? ` (needs ${x.approverRole})` : ''}`);
    if (r) onDone(r.id);
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <FieldRow>
        <Field label="Vendor" required><Select value={vendorId} onChange={(e) => setVendor(e.target.value)}><option value="">Select…</option>{vendors.rows.map((x) => <option key={x.id} value={x.id}>{String(x.name)} · {String(x.country)} · {String(x.currency)}</option>)}</Select></Field>
        <Field label="Currency" help={currency !== 'INR' ? `Import PO · ₹${(rate / 100).toFixed(4)} per ${currency}` : 'Domestic PO'}><Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Incoterm"><Select value={incoterm} onChange={(e) => setIncoterm(e.target.value)}><option value="">—</option>{['EXW', 'FOB', 'CIF', 'DDP', 'FCA'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Payment terms (days)"><Input type="number" min={0} value={terms} className="num" onChange={(e) => setTerms(Number(e.target.value))} /></Field>
        <Field label="Expected delivery"><Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
      </FieldRow>
      <Field label={`Items — unit price in ${currency}`} required><LinesEditor lines={lines} setLines={setLines} withPrice currency={currency} /></Field>
      <Card className="flex items-center justify-between bg-card2 p-4 text-sm"><span>Order value</span><span className="num font-medium">{minor(currency, totalMinor)}{currency !== 'INR' && <span className="ml-2 text-soft">≈ {inr(inrTotal)}</span>}</span></Card>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between"><span className="text-xs font-medium text-soft">Delivery schedule per location (optional)</span><Button type="button" size="sm" variant="ghost" disabled={!lines.length} onClick={() => setSched([...sched, { locationId: 'WH-CENTRAL', skuId: lines[0]!.skuId, qty: lines[0]!.qty, dueDate: expected }])}><Plus className="size-4" />Add</Button></div>
        {sched.map((s, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_80px_130px_auto]">
            <Select value={s.locationId} aria-label="Location" onChange={(e) => setSched(sched.map((x, j) => (j === i ? { ...x, locationId: e.target.value } : x)))}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
            <Select value={s.skuId} aria-label="SKU" onChange={(e) => setSched(sched.map((x, j) => (j === i ? { ...x, skuId: e.target.value } : x)))}>{lines.map((l) => <option key={l.skuId} value={l.skuId}>{String(map.get(l.skuId)?.name ?? l.skuId)}</option>)}</Select>
            <Input type="number" min={1} value={s.qty} className="num" aria-label="Qty" onChange={(e) => setSched(sched.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} />
            <Input type="date" value={s.dueDate} aria-label="Due" onChange={(e) => setSched(sched.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
            <Button type="button" variant="ghost" size="sm" onClick={() => setSched(sched.filter((_, j) => j !== i))}>✕</Button>
          </div>))}
      </div>
      <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="font-sans text-sm" /></Field>
      <div className="flex justify-end"><Button type="submit" loading={busy} disabled={!vendorId || !lines.length || lines.some((l) => !l.qty) || !rate}>Create purchase order</Button></div>
    </form>
  );
}

// ───────────────────────── ASNs & Bills of Entry
export function AsnsTab() {
  const rows = useRows('asns');
  return <DataTable rows={rows} cols={[
    { key: 'number', header: 'ASN', cell: (r) => <b className="font-medium">{r.number}</b> }, { key: 'poNumber', header: 'PO', cell: (r) => <Link className="text-cherry" href={`/scm/purchase/orders/${r.poId}`}>{r.poNumber}</Link> },
    { key: 'vendorName', header: 'Vendor' }, { key: 'eta', header: 'ETA', cell: (r) => dateStr(r.eta) }, { key: 'awb', header: 'AWB / container', cell: (r) => r.awb ?? r.containerNo ?? '—' },
    { key: 'lines', header: 'Units', align: 'right', cell: (r) => (r.lines as Doc[]).reduce((a, l) => a + l.qty, 0) }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  ]} empty={<EmptyState kind="bunny" title="No shipments notified" hint="Vendors create ASNs from the vendor portal." />} />;
}
export function BoeTab() {
  const rows = useRows('billsOfEntry'); const [form, setForm] = React.useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end"><Button size="sm" onClick={() => setForm(true)}><Plus className="size-4" />New Bill of Entry</Button></div>
      <DataTable rows={rows} cols={[
        { key: 'beNumber', header: 'BoE', cell: (r) => <b className="font-medium">{r.beNumber}</b> }, { key: 'poNumber', header: 'PO' }, { key: 'port', header: 'Port' },
        { key: 'assessableValuePaise', header: 'Assessable', align: 'right', cell: (r) => inr(r.assessableValuePaise) }, { key: 'bcdPaise', header: 'BCD', align: 'right', cell: (r) => inr(r.bcdPaise) },
        { key: 'swsPaise', header: 'SWS', align: 'right', cell: (r) => inr(r.swsPaise) }, { key: 'igstPaise', header: 'IGST (credit)', align: 'right', cell: (r) => inr(r.igstPaise) },
        { key: 'totalLandedChargesPaise', header: 'Cost add-on', align: 'right', cell: (r) => inr(r.totalLandedChargesPaise) },
      ]} empty={<EmptyState kind="capybara" title="No bills of entry" />} />
      <SlideOver open={form} onClose={() => setForm(false)} width={560} title="Bill of Entry (import)"><BoeForm onDone={() => setForm(false)} /></SlideOver>
    </div>
  );
}
function BoeForm({ onDone }: { onDone: () => void }) {
  const pos = useRows('purchaseOrders', { where: [['type', '==', 'import']] }); const chas = useMaster('chas'); const { run, busy } = useCommand();
  const [f, setF] = React.useState({ poId: '', beNumber: '', beDate: new Date().toISOString().slice(0, 10), port: 'JNPT Nhava Sheva', chaId: '', av: 0, bcd: 10, sws: 10, igst: 18, cha: 0, other: 0 });
  React.useEffect(() => { if (!f.poId && pos?.[0]) setF((x) => ({ ...x, poId: pos[0]!.id, av: Math.round(pos[0]!.subtotalInrPaise / 100) })); }, [pos]);  
  const d = importDuty({ assessableValuePaise: Math.round(f.av * 100), bcdPct: f.bcd, swsPctOfBcd: f.sws, igstPct: f.igst });
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('saveBillOfEntry', { poId: f.poId, beNumber: f.beNumber, beDate: f.beDate, port: f.port, chaId: f.chaId || null, assessableValuePaise: Math.round(f.av * 100), bcdPct: f.bcd, swsPct: f.sws, igstPct: f.igst, chaChargesPaise: Math.round(f.cha * 100), otherChargesPaise: Math.round(f.other * 100) }, 'Bill of Entry saved'); if (r) onDone(); }}>
      <FieldRow>
        <Field label="Import PO" required><Select value={f.poId} onChange={(e) => set('poId', e.target.value)}>{(pos ?? []).map((p) => <option key={p.id} value={p.id}>{p.number} · {p.vendorName}</option>)}</Select></Field>
        <Field label="BoE number" required><Input value={f.beNumber} onChange={(e) => set('beNumber', e.target.value)} /></Field>
        <Field label="BoE date"><Input type="date" value={f.beDate} onChange={(e) => set('beDate', e.target.value)} /></Field>
        <Field label="Port"><Input value={f.port} onChange={(e) => set('port', e.target.value)} /></Field>
        <Field label="CHA"><Select value={f.chaId} onChange={(e) => set('chaId', e.target.value)}><option value="">—</option>{chas.rows.map((c) => <option key={c.id} value={c.id}>{String(c.name)}</option>)}</Select></Field>
        <Field label="Assessable value (₹)" required><Input type="number" value={f.av} className="num" onChange={(e) => set('av', Number(e.target.value))} /></Field>
        <Field label="BCD %"><Input type="number" value={f.bcd} className="num" onChange={(e) => set('bcd', Number(e.target.value))} /></Field>
        <Field label="SWS % of BCD"><Input type="number" value={f.sws} className="num" onChange={(e) => set('sws', Number(e.target.value))} /></Field>
        <Field label="IGST %"><Input type="number" value={f.igst} className="num" onChange={(e) => set('igst', Number(e.target.value))} /></Field>
        <Field label="CHA charges (₹)"><Input type="number" value={f.cha} className="num" onChange={(e) => set('cha', Number(e.target.value))} /></Field>
        <Field label="Other charges (₹)"><Input type="number" value={f.other} className="num" onChange={(e) => set('other', Number(e.target.value))} /></Field>
      </FieldRow>
      <Card className="grid grid-cols-2 gap-2 bg-card2 p-4 text-sm">
        <span>BCD</span><span className="num">{inr(d.bcdPaise)}</span><span>SWS</span><span className="num">{inr(d.swsPaise)}</span>
        <span>IGST on {inr(d.igstBasePaise)}</span><span className="num">{inr(d.igstPaise)} <em className="text-xs text-soft">input credit</em></span>
        <b>Cost add-on (BCD+SWS+CHA+other)</b><b className="num">{inr(d.landedAddPaise + Math.round((f.cha + f.other) * 100))}</b>
      </Card>
      <div className="flex justify-end"><Button type="submit" loading={busy} disabled={!f.poId || !f.beNumber || !f.av}>Save Bill of Entry</Button></div>
    </form>
  );
}
void FileText; void EmptyState;
