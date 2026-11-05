'use client';
import * as React from 'react';
import { Package, Printer, ScanLine, Truck } from 'lucide-react';
import { Badge, Button, Dialog, EmptyState, Field, Input, Textarea, toast } from '@texafashions/ui';
import { data } from '@/lib/data';
import { DataTable, PageHead, StatusBadge, Tabbed, esc, inr, printHtml, useCommand, useRows, useScope } from '../scm/kit';
import { OmsNav, dt, hoursLeft, type Doc } from './shared';

type Tab = 'open' | 'picked' | 'packed' | 'ready_for_pickup' | 'shipped';
const TABS: { value: Tab; label: string }[] = [{ value: 'open', label: 'To pick' }, { value: 'picked', label: 'To pack' }, { value: 'packed', label: 'To ship / ready' }, { value: 'ready_for_pickup', label: 'Pickup counter' }, { value: 'shipped', label: 'With courier' }];
const NEXT_EVENTS: Record<string, [string, string][]> = {
  booked: [['picked_up', 'Picked up']], picked_up: [['in_transit', 'In transit']], in_transit: [['out_for_delivery', 'Out for delivery'], ['rto_initiated', 'RTO']],
  out_for_delivery: [['delivered', 'Delivered'], ['ndr', 'Undelivered (NDR)']], ndr: [['out_for_delivery', 'Re-attempt'], ['rto_initiated', 'RTO']], rto_initiated: [['rto_delivered', 'RTO reached origin']],
};

export function FulfilmentView() {
  const scope = useScope();
  const rows = useRows('pickLists', { where: scope.where('locationId') }); const [tab, setTab] = React.useState<Tab>('open');
  const [dlg, setDlg] = React.useState<{ kind: 'pick' | 'pack' | 'handover' | 'track'; pl: Doc } | null>(null); const { run, busy } = useCommand();
  const shown = rows?.filter((r) => r.status === tab) ?? null; const n = (s: Tab) => rows?.filter((r) => r.status === s).length ?? 0;
  const sla = (r: Doc) => { const h = hoursLeft(r.slaDueAt); if (h === null || ['shipped', 'collected'].includes(r.status)) return null; return h < 0 ? <Badge tone="cherry">SLA overdue {Math.abs(Math.round(h))}h</Badge> : <Badge tone={h < 6 ? 'butter' : 'mint'}>{Math.round(h)}h left</Badge>; };
  const label = (r: Doc) => printHtml(`Label ${r.awb}`, `<h1 style="font-size:28px;letter-spacing:2px">${esc(r.awb)}</h1><p><b>${esc(r.orderName)}</b> · ${esc(r.locationName)}</p><p><b>Ship to</b><br>${esc(r.shipTo?.name)}<br>${esc(r.shipTo?.address1)}<br>${esc(r.shipTo?.city)}, ${esc(r.shipTo?.state)} ${esc(r.shipTo?.pincode)}<br>${esc(r.shipTo?.phone ?? '')}</p>${r.codAmountPaise ? `<h2>COLLECT ₹${(r.codAmountPaise / 100).toLocaleString('en-IN')}</h2>` : '<p><b>PREPAID</b></p>'}<p style="color:#888;font-size:11px">Mock Shiprocket label preview — not a carrier-valid barcode.</p>`);
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHead title="Fulfilment" sub="Pick list → pack verification scan → courier label (or counter handover for click & collect)." />
      <OmsNav current="/oms/fulfilment" />
      <Tabbed value={tab} onChange={setTab} tabs={TABS.map((t) => ({ value: t.value, label: <>{t.label} {n(t.value) > 0 && <span className="num ml-1 rounded-pill bg-blush/70 px-1.5 text-xs">{n(t.value)}</span>}</> }))} />
      <DataTable rows={shown} empty={<EmptyState kind="capybara" title="Nothing in this queue" />} cols={[
        { key: 'number', header: 'Pick list', cell: (r) => <span><b className="font-medium">{r.number}</b><span className="block text-xs text-soft">{r.orderName}</span></span> },
        { key: 'loc', header: 'Location', cell: (r) => r.locationName },
        { key: 'type', header: 'Type', cell: (r) => <span className="flex flex-wrap gap-1"><Badge tone={r.type === 'bopis' ? 'sky' : 'lavender'}>{r.type === 'bopis' ? 'Pickup' : 'Ship'}</Badge>{r.paymentMode === 'cod' && <Badge tone="butter">{r.type === 'bopis' ? 'Pay at store' : `COD ${inr(r.codAmountPaise)}`}</Badge>}{r.giftNote && <Badge tone="blush">🎁 gift</Badge>}</span> },
        { key: 'items', header: 'Items', align: 'right', cell: (r) => (r.lines as Doc[]).reduce((a, l) => a + l.qty, 0) },
        { key: 'sla', header: 'SLA', cell: sla },
        { key: 'status', header: 'Status', cell: (r) => <span className="flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.shortPick && <Badge tone="cherry">short pick</Badge>}{r.awb && <span className="text-xs text-soft">{r.awb}</span>}</span> },
        { key: 'act', header: '', cell: (r) => (
          <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {r.status === 'open' && <Button size="sm" onClick={() => setDlg({ kind: 'pick', pl: r })}><Package className="size-4" />Pick</Button>}
            {r.status === 'picked' && <Button size="sm" onClick={() => setDlg({ kind: 'pack', pl: r })}><ScanLine className="size-4" />Pack & scan</Button>}
            {r.status === 'packed' && r.type === 'ship' && <Button size="sm" loading={busy} onClick={() => run('createShipment', { pickListId: r.id }, (x) => `AWB ${x.awb} · ${x.courier} · invoice ${x.invoiceNo}`)}><Truck className="size-4" />Create shipment</Button>}
            {r.status === 'packed' && r.type === 'bopis' && <Button size="sm" loading={busy} onClick={() => run('markReadyForPickup', { pickListId: r.id }, (x) => `Customer notified (${x.notified}). Code ${x.pickupCode}`)}>Mark ready</Button>}
            {r.status === 'ready_for_pickup' && <Button size="sm" onClick={() => setDlg({ kind: 'handover', pl: r })}>Hand over</Button>}
            {r.status === 'shipped' && <><Button size="sm" variant="soft" onClick={() => label(r)}><Printer className="size-4" />Label</Button><Button size="sm" variant="soft" onClick={() => setDlg({ kind: 'track', pl: r })}>Track</Button></>}
          </span>) },
      ]} />
      <Dialog open={dlg?.kind === 'pick'} onClose={() => setDlg(null)} title={`Pick ${dlg?.pl.number ?? ''}`} wide>{dlg?.kind === 'pick' && <PickForm pl={dlg.pl} onDone={() => setDlg(null)} />}</Dialog>
      <Dialog open={dlg?.kind === 'pack'} onClose={() => setDlg(null)} title={`Pack & verify ${dlg?.pl.number ?? ''}`} wide>{dlg?.kind === 'pack' && <PackForm pl={dlg.pl} onDone={() => setDlg(null)} />}</Dialog>
      <Dialog open={dlg?.kind === 'handover'} onClose={() => setDlg(null)} title={`Hand over ${dlg?.pl.orderName ?? ''}`}>{dlg?.kind === 'handover' && <HandoverForm pl={dlg.pl} onDone={() => setDlg(null)} />}</Dialog>
      <Dialog open={dlg?.kind === 'track'} onClose={() => setDlg(null)} title={`Tracking ${dlg?.pl.awb ?? ''}`}>{dlg?.kind === 'track' && <TrackPanel awb={dlg.pl.awb} />}</Dialog>
    </div>
  );
}

function PickForm({ pl, onDone }: { pl: Doc; onDone: () => void }) {
  const { run, busy } = useCommand(); const lines = pl.lines as Doc[];
  const [got, setGot] = React.useState<Record<string, number>>(Object.fromEntries(lines.map((l) => [l.skuId, l.qty])));
  const short = lines.filter((l) => got[l.skuId]! < l.qty);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('confirmPick', { pickListId: pl.id, picks: lines.map((l) => ({ skuId: l.skuId, pickedQty: got[l.skuId]! })) }, (x) => (x.short.length ? `Short pick (${x.short.join(', ')}) — ${x.realloc === 'needs_attention' ? 'no other stock, flagged' : x.realloc}` : 'Picked')); if (r) onDone(); }}>
      <p className="text-sm text-soft">Sorted by bin to shorten the walk. If the shelf holds less than the system says, enter what you found — the shortage is re-allocated and the stock is flagged for a count.</p>
      <ul className="divide-y divide-line/60 rounded-2xl border border-line/60">{lines.map((l) => (
        <li key={l.skuId} className="flex items-center justify-between gap-3 px-3 py-2"><span><b className="font-medium">{l.name}</b><span className="block text-xs text-soft">{l.skuId} · bin {l.binId ?? 'shelf'}</span></span>
          <label className="flex items-center gap-2 text-sm">Picked<Input type="number" min={0} max={l.qty} className="!w-20 text-center" value={got[l.skuId]} onChange={(e) => setGot({ ...got, [l.skuId]: Math.max(0, Math.min(l.qty, Number(e.target.value) || 0)) })} aria-label={`Picked ${l.name}`} /><span className="text-soft">of {l.qty}</span></label></li>))}</ul>
      {short.length > 0 && <p className="text-sm text-cherry">Short on {short.map((l) => l.name).join(', ')}.</p>}
      <div className="flex justify-end"><Button type="submit" loading={busy}>Confirm pick</Button></div>
    </form>
  );
}

function PackForm({ pl, onDone }: { pl: Doc; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false); const lines = pl.lines as Doc[]; const [scans, setScans] = React.useState<string[]>([]); const [code, setCode] = React.useState('');
  const [note, setNote] = React.useState<string>(pl.giftNote ?? ''); const [err, setErr] = React.useState<string | null>(null); const inputRef = React.useRef<HTMLInputElement>(null);
  const keyOf = (l: Doc) => String(l.barcode ?? l.skuId);
  const counted = (l: Doc) => scans.filter((s) => s === keyOf(l) || s === l.skuId).length;
  const add = (c: string) => { const v = c.trim(); if (v) setScans((s) => [...s, v]); setCode(''); setErr(null); inputRef.current?.focus(); };
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault(); setErr(null); setBusy(true);
      try { await data().scm.command('packOrder', { pickListId: pl.id, scans, giftNote: note || null }); toast('Packed — verified', 'ok'); onDone(); }
      catch (x) { setErr((x as Error).message); }
      finally { setBusy(false); }
    }}>
      {pl.giftNote && <p className="rounded-xl bg-butter/50 p-2 text-sm">🎁 Include gift note: “{pl.giftNote}”</p>}
      <Field label="Scan each unit (type barcode + Enter)"><div className="flex gap-2"><Input ref={inputRef} autoFocus value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(code); } }} placeholder="Barcode…" aria-label="Scan barcode" /><Button type="button" variant="soft" onClick={() => add(code)}>Add</Button></div></Field>
      <ul className="divide-y divide-line/60 rounded-2xl border border-line/60">{lines.map((l) => { const c = counted(l); return (
        <li key={l.skuId} className="flex items-center justify-between px-3 py-2 text-sm"><span>{l.name}<span className="block text-xs text-soft">{keyOf(l)}</span></span><Badge tone={c === l.qty ? 'mint' : c > l.qty ? 'cherry' : 'butter'}>{c} / {l.qty}</Badge></li>); })}</ul>
      <p className="text-xs text-soft">{scans.length} scan(s) · <button type="button" className="underline" onClick={() => setScans([])}>clear</button> · <button type="button" className="underline" onClick={() => setScans(lines.flatMap((l) => Array(l.qty).fill(keyOf(l)) as string[]))}>demo: scan everything</button></p>
      <Field label="Gift note (optional)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} /></Field>
      {err && <p role="alert" className="rounded-2xl bg-blush/60 p-3 text-sm text-cherry">{err}</p>}
      <div className="flex justify-end"><Button type="submit" loading={busy} disabled={!scans.length}>Verify & pack</Button></div>
    </form>
  );
}

function HandoverForm({ pl, onDone }: { pl: Doc; onDone: () => void }) {
  const { run, busy } = useCommand(); const [code, setCode] = React.useState(''); const [mode, setMode] = React.useState('UPI'); const cod = pl.paymentMode === 'cod';
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('collectBopis', { pickListId: pl.id, code, paidAtStore: cod ? { mode: mode as never } : null }, (x) => `Handed over · invoice ${x.invoiceNo}`); if (r) onDone(); }}>
      <p className="text-sm">Customer: <b>{pl.customerName}</b>. Ask for the 6-digit code from their WhatsApp message and check ID. Hold ends {dt(pl.holdUntil)}.</p>
      <Field label="Pickup code" required><Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} autoFocus aria-label="Pickup code" /></Field>
      {cod && <Field label={`Collect ${inr(pl.payablePaise)} at counter`}><select className="w-full rounded-2xl border border-line bg-card px-4 py-2" value={mode} onChange={(e) => setMode(e.target.value)}><option>UPI</option><option>CASH</option><option>CARD</option></select></Field>}
      <div className="flex justify-end"><Button type="submit" loading={busy} disabled={code.length < 4}>Complete handover</Button></div>
    </form>
  );
}

function TrackPanel({ awb }: { awb: string }) {
  const rows = useRows('shipments', { where: [['awb', '==', awb]] }); const s = rows?.[0]; const { run, busy } = useCommand();
  if (!s) return <p className="text-sm text-soft">Loading…</p>;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={s.status} /><Badge tone="lavender">{s.courier}</Badge><span className="text-soft">ETA {s.etaDate}</span>{s.codAmountPaise > 0 && <Badge tone="butter">COD {inr(s.codAmountPaise)} · {String(s.codStatus).replace(/_/g, ' ')}</Badge>}</div>
      <p className="text-xs text-soft">Invoice {s.invoiceNo} · freight {inr(s.freightPaise)} · {s.courierProvider}</p>
      <ol className="flex flex-col gap-1.5 border-l-2 border-line/70 pl-4 text-xs">{[...(s.events as Doc[])].reverse().map((e, i) => <li key={i}><span className="text-soft">{dt(e.at)}</span> — <b>{String(e.status).replace(/_/g, ' ')}</b>{e.note ? ` · ${e.note}` : ''}</li>)}</ol>
      {NEXT_EVENTS[s.status] && <div><p className="mb-1 text-xs text-soft">Demo: simulate the courier’s next tracking update (in production this arrives on the Shiprocket webhook)</p><div className="flex flex-wrap gap-2">{NEXT_EVENTS[s.status]!.map(([ev, l]) => <Button key={ev} size="sm" variant="soft" loading={busy} onClick={() => run('courierEvent', { awb, event: ev as never }, l)}>{l}</Button>)}</div></div>}
    </div>
  );
}
