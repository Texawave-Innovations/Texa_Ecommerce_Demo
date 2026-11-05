'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Store } from 'lucide-react';
import { Bear, Bunny, Capybara, Button, Card, cn, toast } from '@texafashions/ui';
import { STORE_CODES } from '@texafashions/types';
import { PinPad } from '@/components/PinPad';
import { data } from '@/lib/data';
import { usePos } from '@/lib/store';
import { STORE_NAMES } from '@/lib/stores';
import { FlyLayer } from '@/components/Effects';

export default function Login() {
  const router = useRouter(); const { session, ready, storeId: savedStore } = usePos();
  const [store, setStore] = React.useState<string>(savedStore ?? 'PUN-PMC');
  const [staff, setStaff] = React.useState<string | null>(null);
  const [pin, setPin] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const staffQ = useQuery({ queryKey: ['staff', store], queryFn: () => data().pos.staffList(store), retry: 1 });
  React.useEffect(() => { if (ready && session && savedStore) router.replace('/shift'); }, [ready, session, savedStore, router]);

  const submit = async (p = pin) => {
    if (!staff || p.length < 4 || busy) return;
    setBusy(true); setErr('');
    try {
      await data().pos.pinLogin(store, staff, p);
      if (usePos.getState().storeId !== store) usePos.getState().setTill(null, null);   // a till belongs to one store
      usePos.getState().setStore(store);
      router.replace('/shift');
    } catch (e) { setErr((e as Error).message.replace(/^.*permission-denied:?\s*/i, '')); setPin(''); toast('PIN not accepted', 'err'); }
    finally { setBusy(false); }
  };
  React.useEffect(() => { if (pin.length === 4 && staff) { const t = setTimeout(() => submit(pin), 250); return () => clearTimeout(t); } /* auto-submit 4-digit PINs */
  }, [pin]);

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-between px-10 opacity-80" aria-hidden><Bunny size={110} /><Capybara size={110} /></div>
      <Card className="relative z-10 w-full max-w-3xl">
        <div className="mb-5 flex items-center gap-3"><Bear size={56} /><div><h1 className="font-display text-3xl">Texa Fashions POS</h1><p className="text-sm text-soft">Pick your store, tap your name, enter your PIN.</p></div></div>
        <AnimatePresence mode="wait">
          {!staff ? (
            <motion.div key="pick" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-soft">Store</div>
                <div className="grid max-h-72 gap-1.5 overflow-auto pr-1">
                  {STORE_CODES.map((c) => (
                    <button key={c} onClick={() => setStore(c)} data-testid={`store-${c}`} className={cn('flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-sm transition', store === c ? 'border-cherry bg-blush/50' : 'border-line bg-card hover:bg-card2')}><Store className="size-4 text-soft" />{STORE_NAMES[c]}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-soft">Who is working?</div>
                {staffQ.isLoading && <p className="text-sm text-soft">Loading staff…</p>}
                {staffQ.isError && <p className="rounded-2xl bg-butter/60 p-3 text-sm">Can’t reach the server. Already signed in on this tablet? It will resume automatically; otherwise reconnect and retry.</p>}
                <div className="grid grid-cols-2 gap-3">
                  {staffQ.data?.map((s) => (
                    <button key={s.employeeCode} onClick={() => { setStaff(s.employeeCode); setPin(''); setErr(''); }} data-testid={`staff-${s.employeeCode}`}
                      className="rounded-3xl border border-line bg-card p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:bg-card2 active:scale-95">
                      <div className="mb-2 grid size-12 place-items-center rounded-full bg-lavender font-display text-lg">{s.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div>
                      <div className="font-medium">{s.name}</div><div className="text-xs text-soft">{s.role === 'store_manager' ? 'Store manager' : 'Cashier'} · {s.employeeCode}</div>
                    </button>
                  ))}
                </div>
                <p className="mt-4 rounded-2xl bg-mint/40 p-3 text-xs text-ink/80">Demo PINs — cashier <b>1234</b> · manager <b>4321</b>.</p>
              </div>
            </motion.div>
          ) : (
            <motion.div key="pin" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="flex flex-col items-center">
              <button onClick={() => { setStaff(null); setPin(''); }} className="mb-2 flex items-center gap-1 self-start text-sm text-soft"><ArrowLeft className="size-4" />Back</button>
              <div className="mb-3 text-center"><div className="font-display text-xl">{staffQ.data?.find((s) => s.employeeCode === staff)?.name}</div><div className="text-sm text-soft">Enter your PIN</div></div>
              <PinPad value={pin} onChange={setPin} onSubmit={() => submit()} max={6} disabled={busy} />
              {err && <p className="mt-3 text-sm font-medium text-cherry" role="alert">{err}</p>}
              <Button className="mt-4" size="lg" loading={busy} disabled={pin.length < 4} onClick={() => submit()} data-testid="pin-submit">Sign in</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
      <FlyLayer />
    </main>
  );
}
