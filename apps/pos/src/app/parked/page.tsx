'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Clock, PackageCheck, Play, Plus, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, toast } from '@texafashions/ui';
import type { ParkedBill, ReservationRow } from '@texafashions/data';
import { data } from '@/lib/data';
import { useIsOffline, usePos } from '@/lib/store';
import { Page } from '@/components/Shell';
import { fmtDateTime, inr } from '@/lib/stores';

export default function ParkedPage() { return <Page><Parked /></Page>; }

function Parked() {
  const router = useRouter(); const { storeId, skus, cart } = usePos(); const offline = useIsOffline();
  const [bills, setBills] = React.useState<ParkedBill[]>([]); const [res, setRes] = React.useState<ReservationRow[]>([]);
  const [resOpen, setResOpen] = React.useState(false);
  React.useEffect(() => { if (!storeId) return; const a = data().pos.subscribeParked(storeId, setBills); const b = data().pos.subscribeReservations(storeId, setRes); return () => { a(); b(); }; }, [storeId]);
  const skuMap = new Map(skus.map((s) => [s.id, s]));
  const totalOf = (b: ParkedBill) => b.lines.reduce((a, l) => a + (skuMap.get(l.skuId)?.pricePaise ?? 0) * l.qty, 0);
  const resume = async (b: ParkedBill) => {
    if (cart.length) { toast('Finish or park the current bill first', 'err'); return; }
    const cust = b.customer ? { id: b.customer.id, code: b.customer.id, name: b.customer.name, mobile: b.customer.mobile, tierId: b.customer.tierId, pointsBalance: (await data().pos.getCustomer(b.customer.id).catch(() => null))?.pointsBalance ?? 0 } : null;
    usePos.getState().restoreCart(b.lines.map((l) => ({ lineId: l.lineId, skuId: l.skuId, qty: l.qty, manualDiscountPaise: l.manualDiscountPaise ?? undefined, manualReasonCode: l.manualReasonCode ?? undefined })), cust);
    await data().pos.deleteParked(b.id); router.push('/sell');
  };
  return (
    <div className="mx-auto grid h-full max-w-5xl gap-5 overflow-auto p-5 md:grid-cols-2">
      <section>
        <h2 className="mb-3 font-display text-2xl">Parked bills</h2>
        {!bills.length && <EmptyState title="No parked bills" hint="Park a bill from the Sell screen to serve the next customer." />}
        <div className="space-y-3">
          {bills.map((b) => (
            <Card key={b.id} className="flex items-center justify-between !p-4" data-testid="parked-bill">
              <div><div className="font-medium">{b.label}</div><div className="flex items-center gap-2 text-xs text-soft"><Clock className="size-3" />{fmtDateTime(b.createdAt)} · {b.lines.reduce((a, l) => a + l.qty, 0)} items · ≈ {inr(totalOf(b))}</div></div>
              <div className="flex gap-2"><Button size="sm" onClick={() => resume(b)} data-testid="resume-parked"><Play className="size-3.5" />Resume</Button><Button size="sm" variant="ghost" onClick={() => data().pos.deleteParked(b.id)} aria-label="Discard"><Trash2 className="size-3.5" /></Button></div>
            </Card>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-2xl">Reserved in store</h2><Button size="sm" variant="soft" onClick={() => setResOpen(true)} disabled={offline} data-testid="new-reservation"><Plus className="size-3.5" />Reserve items</Button></div>
        {!res.length && <EmptyState title="Nothing reserved" hint="Hold items for a customer for up to 72 hours — stock is set aside immediately." kind="capybara" />}
        <div className="space-y-3">
          {res.map((r) => (
            <Card key={r.id} className="!p-4" data-testid="reservation">
              <div className="flex items-start justify-between"><div><div className="font-medium">{r.customerName}{r.mobile ? ` · ${r.mobile}` : ''}</div><div className="text-xs text-soft">{r.lines.map((l) => `${l.qty}× ${skuMap.get(l.skuId)?.name ?? l.skuId}`).join(', ')}</div><div className="mt-1 text-xs text-soft">Holds until {fmtDateTime(r.expiresAt)}</div></div><Badge tone={r.status === 'active' ? 'mint' : 'butter'}>{r.status}</Badge></div>
              {r.status === 'active' && <div className="mt-3 flex gap-2"><Button size="sm" variant="soft" onClick={async () => { await data().pos.command('releaseReservation', { reservationId: r.id, reason: 'collected' }); toast('Marked collected — ring the items up', 'ok'); }}><PackageCheck className="size-3.5" />Collected</Button><Button size="sm" variant="ghost" onClick={async () => { await data().pos.command('releaseReservation', { reservationId: r.id, reason: 'cancelled' }); toast('Reservation released', 'ok'); }}><X className="size-3.5" />Release</Button></div>}
            </Card>
          ))}
        </div>
      </section>
      <ReserveDialog open={resOpen} onClose={() => setResOpen(false)} />
    </div>
  );
}

function ReserveDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { storeId, skus } = usePos(); const [name, setName] = React.useState(''); const [mobile, setMobile] = React.useState(''); const [q, setQ] = React.useState('');
  const [lines, setLines] = React.useState<Record<string, number>>({}); const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) { setName(''); setMobile(''); setQ(''); setLines({}); } }, [open]);
  const hits = q.trim().length >= 2 ? skus.filter((s) => !s.isService && (s.name.toLowerCase().includes(q.toLowerCase()) || s.barcode.includes(q))).slice(0, 5) : [];
  const save = async () => {
    if (!storeId) return; setBusy(true);
    try { await data().pos.command('reserveItems', { storeId, customerName: name.trim(), mobile: mobile || null, holdHours: 24, lines: Object.entries(lines).map(([skuId, qty]) => ({ skuId, qty })) }); toast('Items reserved for 24h', 'ok'); onClose(); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const map = new Map(skus.map((s) => [s.id, s]));
  return (
    <Dialog open={open} onClose={onClose} title="Reserve in store">
      <div className="space-y-3">
        <Field label="Customer name" required><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="res-name" /></Field>
        <Field label="Mobile"><Input value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="tel" /></Field>
        <Field label="Add item"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or barcode" /></Field>
        {hits.map((s) => <button key={s.id} onClick={() => { setLines((l) => ({ ...l, [s.id]: (l[s.id] ?? 0) + 1 })); setQ(''); }} className="flex w-full justify-between rounded-2xl border border-line bg-card px-3 py-2 text-left text-sm"><span>{s.name}</span><span>{inr(s.pricePaise)}</span></button>)}
        {Object.entries(lines).map(([id, n]) => <div key={id} className="flex items-center justify-between rounded-2xl bg-card2 px-3 py-2 text-sm"><span>{map.get(id)?.name}</span><span className="flex items-center gap-2"><button onClick={() => setLines((l) => { const c = { ...l }; if (n <= 1) delete c[id]; else c[id] = n - 1; return c; })} className="size-6 rounded-full bg-card">−</button><b>{n}</b><button onClick={() => setLines((l) => ({ ...l, [id]: n + 1 }))} className="size-6 rounded-full bg-card">+</button></span></div>)}
        <Button className="w-full" size="lg" onClick={save} loading={busy} disabled={name.trim().length < 1 || !Object.keys(lines).length} data-testid="res-save">Reserve</Button>
      </div>
    </Dialog>
  );
}
