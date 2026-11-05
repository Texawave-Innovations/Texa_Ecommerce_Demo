'use client';
import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Banknote, CheckCircle2, CreditCard, Gift, QrCode, Smartphone, Split, Star, Ticket, X } from 'lucide-react';
import { Button, Dialog, cn, toast } from '@texafashions/ui';
import { MockPaymentGateway, checkCreditNote, checkGiftCard, redeemBalance, redeemPoints, type CreditNote, type GiftCard } from '@texafashions/domain';
import { ONLINE_ONLY_TENDERS, type TenderMode } from '@texafashions/types';
import { data } from '@/lib/data';
import { onDisplay, sendDisplay } from '@/lib/events';
import { usePos, useIsOffline } from '@/lib/store';
import { usePricing } from '@/lib/cart';
import { inr } from '@/lib/stores';
import { PinPad } from './PinPad';
import { QrSvg } from './Receipt';

type Mode = TenderMode | 'SPLIT' | null;
const BTN: { mode: Exclude<Mode, null>; label: string; icon: typeof Banknote; testid: string }[] = [
  { mode: 'CASH', label: 'Cash', icon: Banknote, testid: 'tender-cash' }, { mode: 'UPI', label: 'UPI', icon: QrCode, testid: 'tender-upi' }, { mode: 'CARD', label: 'Card', icon: CreditCard, testid: 'tender-card' },
  { mode: 'GC', label: 'Gift card', icon: Gift, testid: 'tender-gc' }, { mode: 'CN', label: 'Credit note', icon: Ticket, testid: 'tender-cn' }, { mode: 'POINTS', label: 'Uni Points', icon: Star, testid: 'tender-points' }, { mode: 'SPLIT', label: 'Split', icon: Split, testid: 'tender-split' },
];

export function TenderDialog({ open, onClose, onComplete, completing }: { open: boolean; onClose: () => void; onComplete: () => void; completing: boolean }) {
  const { payments, addPayment, removePayment, clearPayments, setTenderPreview, setSplit, splitMode, customer } = usePos();
  const pricing = usePricing(); const offline = useIsOffline();
  const [mode, setMode] = React.useState<Mode>(null);
  const due = pricing.duePaise; const payable = pricing.invoice.payablePaise;
  const fired = React.useRef(false);

  React.useEffect(() => { if (open) { setMode(null); fired.current = false; } else { setTenderPreview(undefined); setSplit(false); } }, [open, setTenderPreview, setSplit]);
  React.useEffect(() => { if (payments.length === 0) fired.current = false; }, [payments.length]);   // allow a retry after a failed attempt
  // auto-complete the moment the bill is fully covered
  React.useEffect(() => { if (open && payments.length > 0 && due === 0 && !completing && !fired.current) { fired.current = true; onComplete(); } }, [open, payments.length, due, completing, onComplete]);

  const choose = (m: Exclude<Mode, null>) => {
    if (m !== 'SPLIT' && offline && ONLINE_ONLY_TENDERS.includes(m as TenderMode)) { toast(`${m === 'UPI' ? 'UPI' : 'This tender'} needs a connection — use cash or card while offline`, 'err'); return; }
    if (m === 'SPLIT') { setSplit(!splitMode); setTenderPreview(undefined); setMode(null); toast(!splitMode ? 'Split mode: enter an amount for each tender (UPI offer needs full UPI payment)' : 'Split off', 'info'); return; }
    setMode(m);
    if (m === 'UPI' && !splitMode && !payments.some((p) => !['GC', 'CN', 'POINTS'].includes(p.mode))) setTenderPreview('UPI'); else if (m !== 'UPI') setTenderPreview(undefined);
  };

  return (
    <Dialog open={open} onClose={() => { if (!completing) onClose(); }} title="Take payment" wide>
      <div className="grid gap-5 md:grid-cols-[1fr_1.25fr]">
        <div className="space-y-3">
          <div className="rounded-3xl bg-blush/40 p-4 text-center">
            <div className="text-xs font-semibold uppercase tracking-wide text-soft">{due === 0 ? 'Paid in full' : payments.length ? 'Still to pay' : 'Amount due'}</div>
            <motion.div key={due} initial={{ scale: 1.1 }} animate={{ scale: 1 }} className="font-display text-5xl" data-testid="tender-due">{inr(due === 0 && payments.length ? payable : due)}</motion.div>
            {pricing.savingsPaise > 0 && <div className="mt-1 text-sm font-semibold text-emerald-700">You save {inr(pricing.savingsPaise)}</div>}
            {pricing.result.nudges.find((n) => n.kind === 'tender') && !pricing.tender && !payments.length && <div className="mt-2 rounded-pill bg-butter px-3 py-1 text-xs font-semibold">{pricing.result.nudges.find((n) => n.kind === 'tender')!.message}</div>}
          </div>
          <div className="space-y-1.5">
            {payments.map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-2xl border border-line bg-card px-3 py-2 text-sm" data-testid="payment-row">
                <span className="font-medium">{p.mode}{p.ref ? <span className="ml-1 text-xs text-soft">{String(p.ref).slice(-8)}</span> : null}</span>
                <span className="flex items-center gap-2"><b className="num">{inr(p.amountPaise)}</b>{!completing && due > 0 && <button onClick={() => removePayment(i)} aria-label="Remove payment"><X className="size-3.5 text-soft" /></button>}</span>
              </div>
            ))}
            {pricing.changePaise > 0 && <div className="flex justify-between rounded-2xl bg-mint/50 px-3 py-2 text-sm font-semibold" data-testid="change-due"><span>Change to return</span><span>{inr(pricing.changePaise)}</span></div>}
          </div>
          {splitMode && <div className="rounded-2xl bg-lavender/40 px-3 py-2 text-xs font-medium">Split bill — UPI offers need the full amount on UPI.</div>}
          {payments.length > 0 && due > 0 && <Button variant="ghost" size="sm" onClick={() => clearPayments()}>Start over</Button>}
        </div>

        <div>
          <div className="grid grid-cols-4 gap-2">
            {BTN.map((b) => {
              const blocked = b.mode !== 'SPLIT' && offline && ONLINE_ONLY_TENDERS.includes(b.mode as TenderMode);
              const noCust = (b.mode === 'POINTS') && !customer;
              const upiOffer = b.mode === 'UPI' && pricing.result.nudges.some((n) => n.kind === 'tender') && !splitMode;
              return (
                <button key={b.mode} onClick={() => choose(b.mode)} disabled={completing || due === 0 || noCust} data-testid={b.testid}
                  className={cn('relative flex h-20 flex-col items-center justify-center gap-1 rounded-3xl border text-sm font-semibold transition active:scale-95 disabled:opacity-40', (mode === b.mode || (b.mode === 'SPLIT' && splitMode)) ? 'border-cherry bg-blush/60' : 'border-line bg-card hover:bg-card2', blocked && 'opacity-50')}>
                  <b.icon className="size-5" />{b.label}
                  {upiOffer && <span className="absolute -right-1 -top-1 rounded-pill bg-cherry px-1.5 py-0.5 text-[10px] text-cherry-ink">−5%</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-4 min-h-[300px] rounded-3xl bg-card2/60 p-4">
            <AnimatePresence mode="wait">
              <motion.div key={mode ?? 'none'} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {mode === null && <p className="grid h-[260px] place-items-center text-center text-sm text-soft">Choose how the customer is paying.<br />Cash → “Exact” completes the sale in one tap.</p>}
                {mode === 'CASH' && <CashPanel due={due} split={splitMode} onAdd={(amt) => { addPayment({ mode: 'CASH', amountPaise: amt }); setMode(null); }} />}
                {mode === 'CARD' && <CardPanel due={due} split={splitMode} onAdd={(amt, ref) => { addPayment({ mode: 'CARD', amountPaise: amt, ref }); setMode(null); }} />}
                {mode === 'UPI' && <UpiPanel due={due} split={splitMode} onPaid={(amt, utr) => { addPayment({ mode: 'UPI', amountPaise: amt, ref: utr }); setMode(null); }} onCancel={() => { setMode(null); setTenderPreview(undefined); }} />}
                {mode === 'GC' && <InstrumentPanel kind="GC" due={due} onAdd={(amt, ref) => { addPayment({ mode: 'GC', amountPaise: amt, ref }); setMode(null); }} />}
                {mode === 'CN' && <InstrumentPanel kind="CN" due={due} onAdd={(amt, ref) => { addPayment({ mode: 'CN', amountPaise: amt, ref }); setMode(null); }} />}
                {mode === 'POINTS' && customer && <PointsPanel due={due} balance={customer.pointsBalance} onAdd={(amt, pts) => { addPayment({ mode: 'POINTS', amountPaise: amt, points: pts }); setMode(null); }} />}
              </motion.div>
            </AnimatePresence>
          </div>
          {completing && <p className="mt-3 flex items-center justify-center gap-2 text-sm font-medium text-soft"><span className="size-4 animate-spin rounded-full border-2 border-cherry border-t-transparent" />Finalising invoice…</p>}
        </div>
      </div>
    </Dialog>
  );
}

function AmountEntry({ due, onSubmit, label }: { due: number; onSubmit: (paise: number) => void; label: string }) {
  const [v, setV] = React.useState('');
  const paise = Math.round(Number(v || 0) * 100);
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="font-display text-3xl num" data-testid="amount-entry">{v ? inr(paise) : '₹0'}</div>
      <PinPad value={v} onChange={setV} max={7} mask={false} onSubmit={() => paise > 0 && onSubmit(paise)} />
      <Button size="lg" disabled={paise <= 0 || paise > due * 20} onClick={() => onSubmit(paise)} data-testid="amount-ok">{label}</Button>
    </div>
  );
}

function CashPanel({ due, split, onAdd }: { due: number; split: boolean; onAdd: (p: number) => void }) {
  const [custom, setCustom] = React.useState(false);
  const rounded = [100, 500, 1000, 2000].map((n) => Math.ceil(due / (n * 100)) * n * 100).filter((v, i, a) => v > due && a.indexOf(v) === i).slice(0, 3);
  if (split || custom) return <AmountEntry due={due} label="Receive cash" onSubmit={(p) => onAdd(p)} />;
  return (
    <div className="space-y-3">
      <Button size="lg" className="h-16 w-full text-xl" onClick={() => onAdd(due)} data-testid="cash-exact">Exact · {inr(due)}</Button>
      <div className="grid grid-cols-3 gap-2">{rounded.map((v) => <Button key={v} variant="soft" size="lg" onClick={() => onAdd(v)} data-testid={`cash-${v / 100}`}>{inr(v)}</Button>)}</div>
      <Button variant="outline" className="w-full" onClick={() => setCustom(true)}>Other amount</Button>
      <p className="text-center text-xs text-soft">Tendered note → change is calculated for you.</p>
    </div>
  );
}

function CardPanel({ due, split, onAdd }: { due: number; split: boolean; onAdd: (p: number, ref: string) => void }) {
  const [phase, setPhase] = React.useState<'idle' | 'wait'>('idle'); const [amt, setAmt] = React.useState(due);
  const go = (a: number) => { setAmt(a); setPhase('wait'); setTimeout(() => onAdd(a, `EDC${String(Date.now()).slice(-6)}`), 1400); };
  if (phase === 'wait') return <div className="grid h-[260px] place-items-center text-center"><div><motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 1.2 }}><CreditCard className="mx-auto size-14 text-cherry" /></motion.div><p className="mt-3 font-display text-xl">Tap / insert card</p><p className="text-sm text-soft">Approving {inr(amt)} on the terminal… (mock)</p></div></div>;
  if (split) return <AmountEntry due={due} label="Charge card" onSubmit={(a) => go(Math.min(a, due))} />;
  return <div className="space-y-3"><Button size="lg" className="h-16 w-full text-xl" onClick={() => go(due)} data-testid="card-charge">Charge {inr(due)}</Button><p className="text-center text-xs text-soft">Standalone EDC terminal (mock) — works offline.</p></div>;
}

function UpiPanel({ due, split, onPaid, onCancel }: { due: number; split: boolean; onPaid: (amt: number, utr: string) => void; onCancel: () => void }) {
  const [amount, setAmount] = React.useState<number | null>(split ? null : due);
  if (amount === null) return <AmountEntry due={due} label="Show QR" onSubmit={(a) => setAmount(Math.min(a, due))} />;
  return <UpiQrFlow amount={amount} onPaid={onPaid} onCancel={onCancel} />;
}
function UpiQrFlow({ amount, onPaid, onCancel }: { amount: number; onPaid: (amt: number, utr: string) => void; onCancel: () => void }) {
  const ms = usePos((s) => s.upiAutoConfirmMs);
  const [ref] = React.useState(() => `U${usePos.getState().saleId.slice(0, 6).toUpperCase()}${String(Date.now()).slice(-5)}`);
  const gw = React.useMemo(() => new MockPaymentGateway({ autoConfirmMs: ms }), [ms]);
  const intent = React.useMemo(() => gw.createUpiIntent(amount, ref), [gw, amount, ref]);
  const [paid, setPaid] = React.useState<string | null>(null);
  const done = React.useRef(false);
  const finish = React.useCallback((utr: string) => { if (done.current) return; done.current = true; setPaid(utr); sendDisplay({ type: 'upi-paid', ref, utr }); setTimeout(() => onPaid(amount, utr), 700); }, [amount, onPaid, ref]);
  React.useEffect(() => {
    const sig = { cancelled: false };
    const send = () => sendDisplay({ type: 'upi', ref, amountPaise: amount, upiUrl: intent.upiUrl });
    send();
    const off = onDisplay((m) => { if (m.type === 'hello') send(); if (m.type === 'upi-confirm' && m.ref === ref) finish(`MOCKUPI${ref.slice(-6)}`); });
    gw.waitForPayment(intent, sig).then((r) => finish(r.utr)).catch(() => undefined);
    return () => { sig.cancelled = true; off(); if (!done.current) sendDisplay({ type: 'upi-cancel' }); };
  }, [gw, intent, ref, amount, finish]);
  return (
    <div className="flex flex-col items-center gap-3" data-testid="upi-panel">
      {paid ? (
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="grid h-[260px] place-items-center text-center"><div><CheckCircle2 className="mx-auto size-16 text-emerald-600" /><p className="mt-2 font-display text-2xl">Payment received</p><p className="text-xs text-soft">UTR {paid}</p></div></motion.div>
      ) : (
        <>
          <div className="rounded-3xl bg-white p-3 shadow-soft"><QrSvg value={intent.upiUrl} size={170} /></div>
          <div className="text-center"><div className="font-display text-2xl">{inr(amount)}</div><div className="flex items-center justify-center gap-1.5 text-xs text-soft"><Smartphone className="size-3.5" />Customer scans on the customer display or here · waiting…</div></div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-line"><motion.div className="h-full bg-cherry" initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: ms / 1000, ease: 'linear' }} /></div>
          <div className="flex gap-2"><Button variant="soft" onClick={() => finish(`MOCKUPI${ref.slice(-6)}`)} data-testid="upi-simulate">Simulate paid</Button><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
        </>
      )}
    </div>
  );
}

function InstrumentPanel({ kind, due, onAdd }: { kind: 'GC' | 'CN'; due: number; onAdd: (amt: number, ref: string) => void }) {
  const held = usePos((st) => st.instruments.find((i) => i.kind === kind));
  const [code, setCode] = React.useState(held?.id ?? ''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const [found, setFound] = React.useState<{ id: string; balancePaise: number } | null>(null);
  const customer = usePos((s) => s.customer);
  const lookup = async () => {
    setBusy(true); setErr(''); setFound(null);
    try {
      const doc = kind === 'GC' ? await data().pos.getGiftCard(code) : await data().pos.getCreditNote(code);
      if (!doc) throw new Error(kind === 'GC' ? 'Gift card not found' : 'Credit note not found');
      const chk = kind === 'GC' ? checkGiftCard(doc as unknown as GiftCard, new Date()) : checkCreditNote(doc as unknown as CreditNote, new Date(), customer?.id);
      if (!chk.ok) throw new Error(chk.reason);
      setFound({ id: String(doc.id), balancePaise: Number(doc.balancePaise) });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const applied = found ? redeemBalance(kind, found.id, found.balancePaise, due) : null;
  return (
    <div className="space-y-3">
      <label className="block text-xs font-semibold uppercase tracking-wide text-soft">{kind === 'GC' ? 'Gift card number' : 'Credit note number'}</label>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); lookup(); }}>
        <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} data-testid="instrument-code" placeholder={kind === 'GC' ? 'GC-DEMO-0001' : 'CN-PUN-PMC-26-27-00001'} className="h-12 flex-1 rounded-pill border border-line bg-card px-4 uppercase outline-none focus:border-cherry" />
        <Button type="submit" loading={busy} disabled={!code.trim()} data-testid="instrument-lookup">Check</Button>
      </form>
      {err && <p className="rounded-2xl bg-cherry/10 p-2.5 text-sm font-medium text-cherry" role="alert">{err}</p>}
      {found && applied && (
        <div className="space-y-2 rounded-3xl bg-card p-4" data-testid="instrument-found">
          <div className="flex justify-between text-sm"><span className="text-soft">Balance</span><b>{inr(found.balancePaise)}</b></div>
          <div className="flex justify-between text-sm"><span className="text-soft">Applying</span><b className="text-emerald-700">{inr(applied.appliedPaise)}</b></div>
          <div className="flex justify-between text-sm"><span className="text-soft">Balance after</span><b>{inr(applied.balanceAfterPaise)}</b></div>
          {applied.appliedPaise < due && <p className="text-xs text-soft">Partial redemption — {inr(due - applied.appliedPaise)} remains to pay.</p>}
          <Button className="w-full" size="lg" onClick={() => onAdd(applied.appliedPaise, found.id)} data-testid="instrument-apply">Apply {inr(applied.appliedPaise)}</Button>
        </div>
      )}
    </div>
  );
}

function PointsPanel({ due, balance, onAdd }: { due: number; balance: number; onAdd: (amt: number, pts: number) => void }) {
  const [pts, setPts] = React.useState(Math.min(balance, 100));
  const r = redeemPoints(balance, pts, due);
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-sm"><span className="text-soft">Available</span><b>{balance} pts (₹{balance})</b></div>
      <input type="range" min={0} max={Math.max(50, Math.min(balance, Math.floor(due / 200)))} step={10} value={pts} onChange={(e) => setPts(Number(e.target.value))} className="w-full accent-[var(--cherry)]" aria-label="Points to redeem" />
      <div className="text-center font-display text-3xl">{pts} pts → {r.ok ? inr(r.valuePaise) : '—'}</div>
      {!r.ok && <p className="text-center text-xs text-soft">{r.reason}</p>}
      <p className="text-center text-xs text-soft">1 point = ₹1 · max 50% of the bill</p>
      <Button className="w-full" size="lg" disabled={!r.ok} onClick={() => r.ok && onAdd(r.valuePaise, r.points)} data-testid="points-apply">Redeem</Button>
    </div>
  );
}
