'use client';
import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Smartphone } from 'lucide-react';
import { Bear, Bunny, Capybara, Mascot } from '@texafashions/ui';
import { ConfettiLayer } from '@/components/Effects';
import { QrSvg } from '@/components/Receipt';
import { fireConfetti, onDisplay, sendDisplay, type DisplayMsg } from '@/lib/events';
import { inr } from '@/lib/stores';

type View = Exclude<DisplayMsg, { type: 'hello' | 'upi-confirm' }>;

/** Second-screen route for the customer: live bill, savings, UPI dynamic QR (mock auto-confirm) and a thank-you. Linked to the cashier tablet by BroadcastChannel. */
export default function CustomerDisplay() {
  const [v, setV] = React.useState<View>({ type: 'idle' });
  React.useEffect(() => {
    try { document.documentElement.setAttribute('data-theme', 'light'); } catch { /* ignore */ }
    const off = onDisplay((m) => { if (m.type === 'hello' || m.type === 'upi-confirm') return; if (m.type === 'upi-cancel') setV({ type: 'idle' }); else setV(m); if (m.type === 'done') fireConfetti(true); });
    sendDisplay({ type: 'hello' });
    return off;
  }, []);
  return (
    <main className="grid min-h-dvh grid-rows-[auto_1fr] bg-bg" data-testid="customer-display">
      <header className="flex items-center justify-between px-8 py-5"><div className="flex items-center gap-3"><Bear size={52} /><div><div className="font-display text-3xl">Texa Fashions</div><div className="text-sm text-soft">{v.type === 'state' ? v.storeName : 'Welcome'}</div></div></div><div className="font-display text-xl text-soft">Your bill</div></header>
      <AnimatePresence mode="wait">
        {v.type === 'idle' && (
          <motion.section key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid place-items-center text-center">
            <div><div className="flex justify-center gap-6"><Bunny size={150} /><Mascot kind="bear" size={190} /><Capybara size={150} /></div><h1 className="mt-6 font-display text-5xl">Welcome to Texa Fashions!</h1><p className="mt-2 text-xl text-soft">Cute things, curated for you · 5% off when you pay by UPI</p></div>
          </motion.section>
        )}
        {v.type === 'state' && (
          <motion.section key="state" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-[1.4fr_1fr] gap-8 px-8 pb-8">
            <div className="scroll-y space-y-3">
              {v.lines.map((l, i) => (
                <motion.div key={`${l.name}-${i}`} layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center justify-between rounded-3xl bg-card p-5 shadow-soft">
                  <div><div className="text-xl font-medium">{l.name}</div><div className="text-soft">Qty {l.qty}</div></div>
                  <div className="text-right"><div className="font-display text-2xl">{l.free ? 'FREE' : inr(l.netPaise)}</div>{l.grossPaise > l.netPaise && <div className="text-sm text-soft line-through">{inr(l.grossPaise)}</div>}</div>
                </motion.div>
              ))}
            </div>
            <div className="flex flex-col justify-center gap-4 rounded-[32px] bg-blush/50 p-8">
              {v.applied.map((a) => <div key={a.name} className="flex justify-between text-lg"><span>{a.name}</span><b className="text-emerald-700">−{inr(a.amountPaise)}</b></div>)}
              {v.savingsPaise > 0 && <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="rounded-3xl bg-mint px-4 py-3 text-center text-xl font-semibold">You’re saving {inr(v.savingsPaise)} 🎉</motion.div>}
              <div className="text-center"><div className="text-lg text-soft">Total</div><motion.div key={v.payablePaise} initial={{ scale: 1.1 }} animate={{ scale: 1 }} className="font-display text-7xl">{inr(v.payablePaise)}</motion.div></div>
              {v.nudge && <div className="rounded-3xl bg-butter px-4 py-3 text-center text-lg font-medium">{v.nudge}</div>}
              {v.customer && <div className="text-center text-soft">Hi {v.customer.split(' ')[0]}! 💕</div>}
            </div>
          </motion.section>
        )}
        {v.type === 'upi' && <UpiView key="upi" v={v} />}
        {v.type === 'upi-paid' && (
          <motion.section key="paid" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="grid place-items-center text-center"><div><div className="mx-auto grid size-32 place-items-center rounded-full bg-mint text-6xl">✓</div><h1 className="mt-5 font-display text-5xl">Payment received</h1><p className="mt-2 text-soft">UTR {v.utr}</p></div></motion.section>
        )}
        {v.type === 'done' && (
          <motion.section key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid place-items-center text-center">
            <div><Mascot kind="bunny" size={190} /><h1 className="mt-4 font-display text-6xl">Thank you!</h1><p className="mt-1 text-2xl text-soft">Thank you for shopping with us</p>
              <p className="mt-4 text-xl">Paid {inr(v.payablePaise)}{v.savingsPaise > 0 ? ` · saved ${inr(v.savingsPaise)}` : ''}{v.points ? ` · +${v.points} Uni Points ✨` : ''}</p>
              <p className="mt-2 text-soft">Bill {v.invoiceNo}{v.provisional ? ' (provisional)' : ''}</p></div>
          </motion.section>
        )}
      </AnimatePresence>
      <ConfettiLayer />
    </main>
  );
}

function UpiView({ v }: { v: Extract<DisplayMsg, { type: 'upi' }> }) {
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid place-items-center">
      <div className="flex items-center gap-14">
        <div className="rounded-[36px] bg-white p-6 shadow-pop"><QrSvg value={v.upiUrl} size={340} /></div>
        <div className="max-w-md space-y-4">
          <h1 className="font-display text-5xl">Scan to pay</h1>
          <div className="font-display text-7xl text-cherry" data-testid="display-amount">{inr(v.amountPaise)}</div>
          <p className="flex items-center gap-2 text-xl text-soft"><Smartphone className="size-6" />Open any UPI app and scan this code</p>
          <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.6 }} className="text-lg">Waiting for payment…</motion.div>
          <button onClick={() => sendDisplay({ type: 'upi-confirm', ref: v.ref })} data-testid="display-paid" className="rounded-pill bg-ink px-6 py-3 text-lg font-semibold text-bg active:scale-95">I’ve paid (demo)</button>
        </div>
      </div>
    </motion.section>
  );
}
