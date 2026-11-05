'use client';
import * as React from 'react';
import { AlertTriangle, FileUp, Plus, Sparkles } from 'lucide-react';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Select, SlideOver, Textarea, toast } from '@texafashions/ui';
import { daysUntil, landedCost, tdsAmount } from '@texafashions/domain';
import { data } from '@/lib/data';
import { useSession } from '@/lib/stores';
import { DecideButtons } from './purchase';
import { DataTable, FieldRow, LinesEditor, StatusBadge, dateStr, inr, minor, useCommand, useMaster, useRows, useSkus, type LineState } from './kit';

type Doc = Record<string, any>;
const useRole = () => useSession((s) => s.session!.claims.role);

// ───────────────────────── Invoices, OCR, 3-way match, hold queue
export function InvoicesTab() {
  const rows = useRows('purchaseInvoices'); const role = useRole();
  const [form, setForm] = React.useState(false); const [hold, setHold] = React.useState<Doc | null>(null); const [detail, setDetail] = React.useState<string | null>(null);
  const held = (rows ?? []).filter((r) => r.status === 'hold');
  return (
    <div className="flex flex-col gap-4">
      {held.length > 0 && (
        <Card className="border-cherry/40 bg-blush/30 p-4">
          <h3 className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4 text-cherry" />Hold queue — {held.length} invoice{held.length > 1 ? 's' : ''} failed the 3-way match</h3>
          <ul className="mt-2 space-y-2">{held.map((h) => <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span><b className="font-medium">{h.invoiceNo}</b> · {h.vendorName} · {inr(h.totalPaise)}</span>{role === 'cfo' || role === 'super_admin' ? <Button size="sm" onClick={() => setHold(h)}>Review</Button> : <span className="text-xs text-soft">CFO to resolve</span>}</li>)}</ul>
        </Card>)}
      <div className="flex justify-end">{role === 'cfo' && <Button size="sm" onClick={() => setForm(true)}><Plus className="size-4" />Record purchase invoice</Button>}</div>
      <DataTable rows={rows} onRow={(r) => setDetail(r.id)} cols={[
        { key: 'invoiceNo', header: 'Invoice', cell: (r) => <b className="font-medium">{r.invoiceNo}</b> }, { key: 'vendorName', header: 'Vendor' }, { key: 'poNumber', header: 'PO' },
        { key: 'invoiceDate', header: 'Date', cell: (r) => dateStr(r.invoiceDate) }, { key: 'totalPaise', header: 'Total', align: 'right', cell: (r) => inr(r.totalPaise) },
        { key: 'ocr', header: 'OCR', cell: (r) => (r.ocrUsed ? <Badge tone={r.ocrUsed === 'claude' ? 'lavender' : 'butter'}>{r.ocrUsed === 'claude' ? 'Claude' : 'mock'}</Badge> : '—') },
        { key: 'status', header: '3-way match', cell: (r) => <StatusBadge status={r.status} /> },
      ]} empty={<EmptyState kind="capybara" title="No purchase invoices" hint="Upload a vendor invoice and let OCR read it." />} />
      <SlideOver open={form} onClose={() => setForm(false)} width={760} title="Purchase invoice"><InvoiceForm onDone={(r) => { setForm(false); setDetail(r); }} /></SlideOver>
      <Dialog open={!!hold} onClose={() => setHold(null)} title={`Resolve hold — ${hold?.invoiceNo ?? ''}`} wide>{hold && <HoldForm inv={hold} onDone={() => setHold(null)} />}</Dialog>
      <Dialog open={!!detail} onClose={() => setDetail(null)} title="3-way match result" wide>{detail && <MatchView invoiceId={detail} />}</Dialog>
    </div>
  );
}
function MatchView({ invoiceId }: { invoiceId: string }) {
  const [m, setM] = React.useState<Doc | null>(null); const { name } = useSkus();
  React.useEffect(() => { data().scm.get('matchResults', invoiceId).then(setM); }, [invoiceId]);
  if (!m) return <p className="text-sm text-soft">Loading…</p>;
  const ISSUE: Record<string, string> = { not_on_po: 'Not on PO', no_grn: 'No GRN', over_billed_qty: 'Billed > accepted', price_variance: 'Price > PO', over_ordered: 'Billed > ordered' };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2"><StatusBadge status={m.status} /><span className="text-sm text-soft">Tolerance: price {(m.tolerance.priceBps / 100).toFixed(1)}%, qty ±{m.tolerance.qtyUnits}, total {(m.tolerance.totalBps / 100).toFixed(1)}%</span></div>
      <Card className="overflow-x-auto p-0"><table className="w-full text-sm"><thead className="bg-card2 text-left text-xs text-soft"><tr><th className="p-3">Item</th><th className="p-3 text-right">PO qty</th><th className="p-3 text-right">GRN accepted</th><th className="p-3 text-right">Billed before</th><th className="p-3 text-right">This invoice</th><th className="p-3 text-right">PO price</th><th className="p-3 text-right">Invoice price</th><th className="p-3">Result</th></tr></thead>
        <tbody>{(m.lines as Doc[]).map((l) => <tr key={l.skuId} className="border-t border-line/60"><td className="p-3">{name(l.skuId)}</td><td className="num p-3">{l.poQty}</td><td className="num p-3">{l.grnQty}</td><td className="num p-3">{l.billedBefore}</td><td className="num p-3">{l.invQty}</td><td className="num p-3">{(l.poPrice / 100).toLocaleString('en-IN')}</td><td className={`num p-3 ${l.issues.includes('price_variance') ? 'font-medium text-cherry' : ''}`}>{(l.invPrice / 100).toLocaleString('en-IN')}</td><td className="p-3">{l.issues.length ? l.issues.map((i: string) => <Badge key={i} tone="cherry" className="mr-1">{ISSUE[i]}</Badge>) : <Badge tone="mint">ok</Badge>}</td></tr>)}</tbody></table></Card>
      {m.reasons?.length > 0 && <ul className="list-disc pl-5 text-sm text-cherry">{m.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>}
    </div>
  );
}
function HoldForm({ inv, onDone }: { inv: Doc; onDone: () => void }) {
  const { run, busy } = useCommand(); const [note, setNote] = React.useState('');
  return (
    <div className="flex flex-col gap-4"><MatchView invoiceId={inv.id} />
      <Field label="Resolution note (audited)" required><Textarea rows={2} className="font-sans text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Price revision agreed with vendor by e-mail on …" /></Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={busy || note.length < 3} onClick={async () => { if (await run('resolveHold', { invoiceId: inv.id, action: 'reject', note }, 'Invoice rejected')) onDone(); }}>Reject invoice</Button>
        <Button variant="outline" disabled={busy || note.length < 3} onClick={async () => { const r = await run('resolveHold', { invoiceId: inv.id, action: 'rematch', note }, (x) => `Re-matched: ${x.status}`); if (r) onDone(); }}>Re-run match</Button>
        <Button disabled={busy || note.length < 3} onClick={async () => { if (await run('resolveHold', { invoiceId: inv.id, action: 'override', note }, 'Overridden → AP bill created')) onDone(); }}>Approve override</Button>
      </div>
    </div>
  );
}
function InvoiceForm({ onDone }: { onDone: (id: string) => void }) {
  const pos = useRows('purchaseOrders'); const { map } = useSkus(); const { run, busy } = useCommand();
  const eligible = (pos ?? []).filter((p) => (p.lines as Doc[]).some((l) => l.acceptedQty - l.billedQty > 0));
  const [poId, setPo] = React.useState(''); const po = eligible.find((p) => p.id === poId);
  const [no, setNo] = React.useState(''); const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10)); const [lines, setLines] = React.useState<LineState[]>([]);
  const [file, setFile] = React.useState<{ path: string; name: string } | null>(null); const [ocr, setOcr] = React.useState<'claude' | 'mock' | null>(null); const [reading, setReading] = React.useState(false); const [result, setResult] = React.useState<Doc | null>(null);
  const gst = (id: string) => Number((po?.lines as Doc[] | undefined)?.find((l) => l.skuId === id)?.gstRate ?? 0);
  async function upload(f?: File) {
    if (!f || !po) return; setReading(true);
    try {
      const path = await data().scm.uploadFile(`scm/invoices/${Date.now()}-${f.name}`, f); setFile({ path, name: f.name });
      const r = await data().scm.command('ocrInvoice', { storagePath: path, poId });
      setOcr(r.usedClaude ? 'claude' : 'mock'); if (r.invoiceNo) setNo(r.invoiceNo); if (r.invoiceDate) setDate(r.invoiceDate);
      setLines((r.lines as Doc[]).filter((l) => l.skuId).map((l) => ({ skuId: l.skuId, qty: l.qty, price: l.unitPriceMinor / 100 })));
      const unmapped = (r.lines as Doc[]).filter((l) => !l.skuId).length;
      toast(r.usedClaude ? `Claude read the invoice${unmapped ? ` — ${unmapped} line(s) could not be matched to the PO` : ''}` : 'Mock OCR (no ANTHROPIC_API_KEY): pre-filled from the PO balance', r.usedClaude ? 'ok' : 'info');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setReading(false); }
  }
  React.useEffect(() => { setLines([]); setFile(null); setOcr(null); }, [poId]);
  void map;
  if (result) return (
    <div className="flex flex-col gap-4"><Card className={`p-4 ${result.status === 'matched' ? 'bg-mint/40' : 'bg-blush/40'}`}><b>{result.status === 'matched' ? '✓ 3-way match passed — AP bill created' : '⚠ Placed on HOLD'}</b>{result.reasons?.map((r: string) => <p key={r} className="text-sm">{r}</p>)}</Card>
      <MatchView invoiceId={result.id} /><div className="flex justify-end"><Button onClick={() => onDone(result.id)}>Close</Button></div></div>);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('saveInvoice', { vendorId: po!.vendorId, poId, invoiceNo: no, invoiceDate: date, filePath: file?.path ?? null, ocrUsed: ocr, lines: lines.filter((l) => l.qty > 0).map((l) => ({ skuId: l.skuId, qty: l.qty, unitPriceMinor: Math.round((l.price ?? 0) * 100), gstRate: gst(l.skuId) })) }); if (r) setResult(r); }}>
      <Field label="Purchase order" required><Select value={poId} onChange={(e) => setPo(e.target.value)}><option value="">Select a PO with goods accepted…</option>{eligible.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.vendorName}</option>)}</Select></Field>
      {po && <>
        <Card className="flex flex-wrap items-center gap-3 bg-card2 p-4">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-pill bg-lavender/70 px-4 py-2 text-sm hover:bg-lavender"><FileUp className="size-4" />{reading ? 'Reading…' : 'Upload invoice (PDF / image)'}<input type="file" accept="application/pdf,image/*" hidden onChange={(e) => upload(e.target.files?.[0])} /></label>
          {file && <span className="text-sm text-soft">{file.name}</span>}{ocr && <Badge tone={ocr === 'claude' ? 'lavender' : 'butter'}><Sparkles className="size-3" />{ocr === 'claude' ? 'Read by Claude' : 'Mock OCR'}</Badge>}
          <span className="basis-full text-xs text-soft">OCR runs in a Cloud Function and pre-fills the form — always check the figures before saving.</span>
        </Card>
        <FieldRow><Field label="Vendor invoice no." required><Input value={no} onChange={(e) => setNo(e.target.value)} /></Field><Field label="Invoice date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></FieldRow>
        <Field label={`Billed items — unit price in ${po.currency} (before tax)`} required><LinesEditor lines={lines} setLines={setLines} withPrice currency={po.currency} /></Field>
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setLines((po.lines as Doc[]).filter((l) => l.acceptedQty - l.billedQty > 0).map((l) => ({ skuId: l.skuId, qty: l.acceptedQty - l.billedQty, price: l.unitPriceMinor / 100 })))}>Fill with unbilled accepted goods</Button>
        <div className="flex justify-end"><Button type="submit" loading={busy} disabled={!no || !lines.length}>Save & run 3-way match</Button></div></>}
    </form>
  );
}

// ───────────────────────── AP bills & payments
export function BillsTab() {
  const rows = useRows('apBills'); const role = useRole(); const [pay, setPay] = React.useState<Doc | null>(null);
  const open = (rows ?? []).filter((b) => b.status !== 'paid');
  const msme = open.filter((b) => b.isMsme && daysUntil(new Date(b.dueDate)) <= 7);
  const total = open.reduce((a, b) => a + b.balancePaise, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3"><Card className="p-4"><p className="text-xs text-soft">Outstanding payables</p><p className="font-display text-2xl">{inr(total)}</p></Card><Card className="p-4"><p className="text-xs text-soft">Open bills</p><p className="font-display text-2xl">{open.length}</p></Card>
        <Card className={`p-4 ${msme.length ? 'bg-butter/50' : ''}`}><p className="text-xs text-soft">MSME bills due ≤ 7 days (45-day rule)</p><p className="font-display text-2xl">{msme.length}</p></Card></div>
      <DataTable rows={rows} cols={[
        { key: 'invoiceNo', header: 'Invoice', cell: (r) => <b className="font-medium">{r.invoiceNo}</b> }, { key: 'vendorName', header: 'Vendor', cell: (r) => <>{r.vendorName} {r.isMsme && <Badge tone="butter">MSME</Badge>}</> },
        { key: 'dueDate', header: 'Due', cell: (r) => { const d = daysUntil(new Date(r.dueDate)); return <span className={r.status !== 'paid' && d <= 7 ? 'font-medium text-cherry' : ''}>{dateStr(r.dueDate)}{r.status !== 'paid' && <span className="ml-1 text-xs">({d < 0 ? `${-d}d overdue` : `${d}d`})</span>}</span>; } },
        { key: 'totalPaise', header: 'Bill', align: 'right', cell: (r) => inr(r.totalPaise) }, { key: 'paidPaise', header: 'Paid', align: 'right', cell: (r) => inr(r.paidPaise) }, { key: 'balancePaise', header: 'Balance', align: 'right', cell: (r) => <b>{inr(r.balancePaise)}</b> },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        { key: 'act', header: '', cell: (r) => r.status !== 'paid' && role === 'cfo' ? <Button size="sm" onClick={() => setPay(r)}>Pay</Button> : null },
      ]} empty={<EmptyState kind="bunny" title="No payables" />} />
      <Dialog open={!!pay} onClose={() => setPay(null)} title={`Pay ${pay?.vendorName ?? ''}`}>{pay && <PayForm bill={pay} onDone={() => setPay(null)} />}</Dialog>
    </div>
  );
}
function PayForm({ bill, onDone }: { bill: Doc; onDone: () => void }) {
  const { run, busy } = useCommand(); const banks = useMaster('bankAccounts');
  const [kind, setKind] = React.useState<'full' | 'part'>('full'); const [amt, setAmt] = React.useState(bill.balancePaise / 100); const [mode, setMode] = React.useState('bank_transfer'); const [bank, setBank] = React.useState('BA-HDFC');
  const paise = kind === 'full' ? bill.balancePaise : Math.round(amt * 100);
  const tds = tdsAmount(Math.round(paise * (bill.taxablePaise / bill.grossPaise)), bill.tdsRatePct);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('postPayment', { vendorId: bill.vendorId, kind, invoiceIds: [bill.id], amountPaise: paise, mode: mode as 'upi', bankAccountId: bank || null }, (x) => `${x.number} ${x.status === 'posted' ? 'posted' : `awaiting ${String(x.approverRole).replace('_', ' ')} approval`}`); if (r) onDone(); }}>
      <p className="text-sm text-soft">{bill.invoiceNo} · balance {inr(bill.balancePaise)} · due {dateStr(bill.dueDate)}</p>
      <FieldRow>
        <Field label="Payment"><Select value={kind} onChange={(e) => setKind(e.target.value as 'full' | 'part')}><option value="full">Full settlement</option><option value="part">Part payment</option></Select></Field>
        <Field label="Amount (₹)"><Input type="number" step="0.01" max={bill.balancePaise / 100} disabled={kind === 'full'} value={kind === 'full' ? bill.balancePaise / 100 : amt} className="num" onChange={(e) => setAmt(Number(e.target.value))} /></Field>
        <Field label="Mode"><Select value={mode} onChange={(e) => setMode(e.target.value)}>{['bank_transfer', 'upi', 'cheque', 'cash'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</Select></Field>
        <Field label="Bank account"><Select value={bank} onChange={(e) => setBank(e.target.value)}>{banks.rows.map((b) => <option key={b.id} value={b.id}>{String(b.name)}</option>)}</Select></Field>
      </FieldRow>
      <Card className="grid grid-cols-2 gap-1 bg-card2 p-4 text-sm"><span>Gross</span><span className="num">{inr(paise)}</span><span>TDS @ {bill.tdsRatePct}% (on taxable part)</span><span className="num">− {inr(tds)}</span><b>Net to vendor</b><b className="num">{inr(paise - tds)}</b></Card>
      <p className="text-xs text-soft">Above ₹2,00,000 the voucher goes to a Super Admin for approval.</p>
      <div className="flex justify-end"><Button type="submit" loading={busy} disabled={paise <= 0 || paise > bill.balancePaise}>Post payment</Button></div>
    </form>
  );
}
export function PaymentsTab() {
  const rows = useRows('paymentVouchers');
  return <DataTable rows={rows} cols={[
    { key: 'number', header: 'Voucher', cell: (r) => <b className="font-medium">{r.number}</b> }, { key: 'vendorName', header: 'Vendor' }, { key: 'kind', header: 'Type', cell: (r) => <span className="capitalize">{r.kind}</span> },
    { key: 'amountPaise', header: 'Gross', align: 'right', cell: (r) => inr(r.amountPaise) }, { key: 'tdsPaise', header: 'TDS', align: 'right', cell: (r) => (r.tdsPaise !== undefined ? inr(r.tdsPaise) : '—') }, { key: 'netPaise', header: 'Net paid', align: 'right', cell: (r) => (r.netPaise !== undefined ? inr(r.netPaise) : '—') },
    { key: 'mode', header: 'Mode' }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'act', header: '', cell: (r) => <DecideButtons collection="paymentVouchers" doc={r} /> },
  ]} empty={<EmptyState kind="capybara" title="No payments yet" />} />;
}

// ───────────────────────── Landed cost
export function LandedTab() {
  const rows = useRows('landedCosts'); const [form, setForm] = React.useState(false); const role = useRole(); const { name } = useSkus();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{['cfo', 'warehouse_manager', 'buyer', 'super_admin'].includes(role) && <Button size="sm" onClick={() => setForm(true)}><Plus className="size-4" />Apply landed cost</Button>}</div>
      <DataTable rows={rows} cols={[
        { key: 'poNumber', header: 'PO', cell: (r) => <b className="font-medium">{r.poNumber}</b> }, { key: 'basis', header: 'Apportioned by', cell: (r) => <span className="capitalize">{r.basis}</span> },
        { key: 'charges', header: 'Charges', cell: (r) => (r.charges as Doc[]).filter((c) => c.amountPaise > 0).map((c) => c.type).join(', ') }, { key: 'totalChargesPaise', header: 'Total', align: 'right', cell: (r) => inr(r.totalChargesPaise) },
        { key: 'igstCreditPaise', header: 'IGST credit', align: 'right', cell: (r) => inr(r.igstCreditPaise) },
        { key: 'lines', header: 'Cost uplift / unit', cell: (r) => (r.lines as Doc[]).slice(0, 2).map((l) => `${name(l.skuId)}: +${inr(l.addPerUnitPaise)}`).join(' · ') },
      ]} empty={<EmptyState kind="bear" title="No landed costs" hint="Freight, customs and CHA charges are spread over received goods." />} />
      <SlideOver open={form} onClose={() => setForm(false)} width={640} title="Landed cost"><LandedForm onDone={() => setForm(false)} /></SlideOver>
    </div>
  );
}
function LandedForm({ onDone }: { onDone: () => void }) {
  const pos = useRows('purchaseOrders'); const grns = useRows('grns'); const boes = useRows('billsOfEntry'); const { run, busy } = useCommand(); const { name } = useSkus();
  const [poId, setPo] = React.useState(''); const [picked, setPicked] = React.useState<string[]>([]); const [basis, setBasis] = React.useState<'value' | 'weight' | 'qty'>('value'); const [boe, setBoe] = React.useState('');
  const [charges, setCharges] = React.useState([{ type: 'freight inward', amount: 0 }, { type: 'insurance', amount: 0 }]);
  const eligible = (grns ?? []).filter((g) => g.poId === poId && !g.landedCostId); const po = (pos ?? []).find((p) => p.id === poId);
  const boeRow = (boes ?? []).find((b) => b.id === boe);
  const preview = React.useMemo(() => {
    const items = eligible.filter((g) => picked.includes(g.id)).flatMap((g) => (g.lines as Doc[]).filter((l) => l.goodQty > 0).map((l) => ({ key: `${g.id}|${l.skuId}`, skuId: l.skuId, qty: l.goodQty, valuePaise: l.goodQty * l.unitCostPaise, weightGrams: (po?.lines as Doc[] | undefined)?.find((p) => p.skuId === l.skuId)?.weightGrams ?? undefined })));
    const all = [...charges.map((c) => ({ type: c.type, amountPaise: Math.round(c.amount * 100) })), ...(boeRow ? [{ type: 'customs', amountPaise: boeRow.landedAddPaise + boeRow.chaChargesPaise + boeRow.otherChargesPaise }] : [])];
    try { return items.length ? { items, res: landedCost(items, all, basis), error: undefined } : null; } catch (e) { return { error: (e as Error).message, items: undefined, res: undefined }; }
  }, [picked, charges, basis, boeRow, eligible.length]);  
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('postLandedCost', { poId, grnIds: picked, basis, boeId: boe || null, charges: charges.map((c) => ({ type: c.type, amountPaise: Math.round(c.amount * 100) })) }, (x) => `Applied ${inr(x.totalChargesPaise)} · IGST credit ${inr(x.igstCreditPaise)}`); if (r) onDone(); }}>
      <Field label="Purchase order" required><Select value={poId} onChange={(e) => { setPo(e.target.value); setPicked([]); }}><option value="">Select…</option>{(pos ?? []).filter((p) => ['received', 'partially_received'].includes(p.status)).map((p) => <option key={p.id} value={p.id}>{p.number} · {p.vendorName}</option>)}</Select></Field>
      {poId && <>
        <Field label="GRNs to cost" required><div className="flex flex-wrap gap-2">{eligible.map((g) => <label key={g.id} className="flex items-center gap-2 rounded-pill border border-line px-3 py-1 text-sm"><input type="checkbox" className="accent-[var(--cherry)]" checked={picked.includes(g.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, g.id] : picked.filter((x) => x !== g.id))} />{g.number}</label>)}{!eligible.length && <span className="text-sm text-soft">No un-costed GRNs on this PO.</span>}</div></Field>
        <FieldRow><Field label="Apportion by"><Select value={basis} onChange={(e) => setBasis(e.target.value as 'value')}><option value="value">Value</option><option value="qty">Quantity</option><option value="weight">Weight (needs PO line weights)</option></Select></Field>
          {po?.type === 'import' && <Field label="Bill of Entry (customs auto-added)"><Select value={boe} onChange={(e) => setBoe(e.target.value)}><option value="">—</option>{(boes ?? []).filter((b) => b.poId === poId).map((b) => <option key={b.id} value={b.id}>{b.beNumber}</option>)}</Select></Field>}</FieldRow>
        <div className="flex flex-col gap-2"><div className="flex items-center justify-between"><span className="text-xs font-medium text-soft">Additional charges (₹)</span><Button type="button" size="sm" variant="ghost" onClick={() => setCharges([...charges, { type: 'other', amount: 0 }])}><Plus className="size-4" />Add</Button></div>
          {charges.map((c, i) => <div key={i} className="grid grid-cols-[1fr_140px_auto] gap-2"><Input value={c.type} aria-label="Charge type" onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} /><Input type="number" min={0} className="num" aria-label="Amount" value={c.amount} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} /><Button type="button" variant="ghost" size="sm" onClick={() => setCharges(charges.filter((_, j) => j !== i))}>✕</Button></div>)}</div>
        {preview?.error && <p className="text-sm text-cherry">{preview.error}</p>}
        {preview && 'res' in preview && preview.res && preview.items && <Card className="p-4"><p className="mb-2 text-sm font-medium">Preview — {inr(preview.res.totalChargesPaise)} spread by {basis}</p><ul className="space-y-1 text-sm">{preview.res.lines.map((l, i) => <li key={l.key} className="flex justify-between"><span>{name(preview.items[i]!.skuId)}</span><span className="num">+{inr(l.addPerUnitPaise)}/unit → {inr(l.landedUnitCostPaise)}</span></li>)}</ul><p className="mt-2 text-xs text-soft">IGST is booked as input credit, never added to cost.</p></Card>}
      </>}
      <div className="flex justify-end"><Button type="submit" loading={busy} disabled={!picked.length}>Apply to stock cost</Button></div>
    </form>
  );
}
void minor;
