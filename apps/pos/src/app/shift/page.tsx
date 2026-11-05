'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Lock, Play } from 'lucide-react';
import { Bear, Button, Card, Field, Input, cn, toast, Badge } from '@texafashions/ui';
import type { PosSku } from '@texafashions/types';
import { data } from '@/lib/data';
import { usePos } from '@/lib/store';
import { Page } from '@/components/Shell';
import { inr } from '@/lib/stores';
import type { TillRow } from '@texafashions/data';

export default function ShiftPage() {
  return <Page needShift={false}><ShiftInner /></Page>;
}

function ShiftInner() {
  const router = useRouter(); const { storeId, session, skus, promotions, catalogueReady } = usePos();
  const [tills, setTills] = React.useState<TillRow[]>([]);
  const [pick, setPick] = React.useState<string | null>(null);
  const [floatRupees, setFloat] = React.useState('2000');
  const [busy, setBusy] = React.useState(false);
  const [customers, setCustomers] = React.useState<number | null>(null);
  React.useEffect(() => { if (!storeId) return; return data().pos.subscribeTills(storeId, setTills); }, [storeId]);
  React.useEffect(() => {
    let live = true;
    try { if (sessionStorage.getItem('pos.warm') === storeId) { setCustomers(-1); return; } } catch { /* ignore */ }
    data().pos.warmCustomerCache().then((n) => { if (live) { setCustomers(n); try { sessionStorage.setItem('pos.warm', String(storeId)); } catch { /* ignore */ } } }).catch(() => live && setCustomers(0));
    return () => { live = false; };
  }, [storeId]);

  const resume = (t: TillRow) => { usePos.getState().setTill(t.id, t.openShiftId); router.replace('/sell'); };
  const open = async () => {
    if (!pick || !storeId) return; setBusy(true);
    try {
      const r = (await data().pos.command('openShift', { tillId: pick, storeId, openingFloatPaise: Math.round(Number(floatRupees || 0) * 100) })) as { shiftId?: string; id?: string };
      const id = r.shiftId ?? r.id; if (!id) throw new Error('No shift id returned');
      usePos.getState().setTill(pick, id); toast('Shift opened', 'ok'); router.replace('/sell');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const ready = (n: number, label: string, done: boolean) => (
    <div className="flex items-center gap-2 text-sm">{done ? <Check className="size-4 text-emerald-600" /> : <Loader2 className="size-4 animate-spin text-soft" />}<span className={cn(!done && 'text-soft')}>{label}</span>{done && n >= 0 && <Badge tone="mint">{n.toLocaleString('en-IN')}</Badge>}</div>
  );
  return (
    <div className="mx-auto grid h-full max-w-4xl content-center gap-5 p-6 md:grid-cols-[1.3fr_1fr]">
      <Card>
        <div className="mb-4 flex items-center gap-3"><Bear size={44} /><div><h1 className="font-display text-2xl">Open your shift</h1><p className="text-sm text-soft">Hi {session?.name?.split(' ')[0]} — choose a till.</p></div></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {tills.map((t) => {
            const busyTill = !!t.openShiftId;
            return (
              <button key={t.id} data-testid={`till-${t.id}`} onClick={() => (busyTill ? resume(t) : setPick(t.id))}
                className={cn('rounded-3xl border p-4 text-left transition active:scale-95', pick === t.id ? 'border-cherry bg-blush/50' : 'border-line bg-card hover:bg-card2')}>
                <div className="flex items-center justify-between"><span className="font-display text-lg">{t.name}</span>{busyTill ? <Lock className="size-4 text-soft" /> : <Play className="size-4 text-cherry" />}</div>
                <div className="text-xs text-soft">{busyTill ? 'Shift in progress — tap to resume' : 'Free'}</div>
              </button>
            );
          })}
          {!tills.length && <p className="text-sm text-soft">No tills found for this store.</p>}
        </div>
        {pick && (
          <div className="mt-5 grid items-end gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Opening cash float (₹)"><Input inputMode="numeric" value={floatRupees} onChange={(e) => setFloat(e.target.value.replace(/\D/g, ''))} data-testid="float-input" className="text-lg" /></Field>
            <Button size="lg" onClick={open} loading={busy} data-testid="open-shift">Open shift · {inr(Math.round(Number(floatRupees || 0) * 100))}</Button>
          </div>
        )}
      </Card>
      <Card className="space-y-2.5">
        <h2 className="font-display text-lg">Offline readiness</h2>
        <p className="text-xs text-soft">Everything below is cached on this tablet, so selling continues if the Wi-Fi drops.</p>
        {ready(skus.length, 'Product catalogue', catalogueReady)}
        {ready(promotions.length, 'Promotions', promotions.length > 0)}
        {ready(customers ?? 0, 'Customers (mobile lookup)', customers !== null)}
        {ready(-1, 'App shell (PWA)', typeof navigator !== 'undefined' && 'serviceWorker' in navigator)}
        <p className="rounded-2xl bg-butter/50 p-3 text-xs">Offline sales accept <b>cash &amp; card</b>. UPI, gift cards, vouchers and points need a connection.</p>
      </Card>
    </div>
  );
}
export type { PosSku };
