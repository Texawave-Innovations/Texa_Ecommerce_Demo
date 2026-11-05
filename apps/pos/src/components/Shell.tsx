'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { CloudOff, Cloud, Monitor, RotateCcw, PauseCircle, FileText, History, LogOut, WifiOff, Loader2, Receipt as ReceiptIcon } from 'lucide-react';
import { Bear, cn, toast, MascotLoader } from '@texafashions/ui';
import type { PosOutboxRow } from '@texafashions/types';
import { data } from '@/lib/data';
import { usePos, useIsOffline } from '@/lib/store';
import { ConfettiLayer, FlyLayer } from './Effects';

/** Live subscriptions that keep the local (IndexedDB-backed) catalogue, stock and promotions fresh. Mounted once for every signed-in screen. */
export function useBoot() {
  const storeId = usePos((s) => s.storeId); const shiftId = usePos((s) => s.shiftId); const session = usePos((s) => s.session);
  const { setSkus, setStock, setPromotions, setShift, setStoreInfo } = usePos.getState();
  React.useEffect(() => {
    if (!session || !storeId) return;
    const d = data();
    const offs = [d.pos.subscribeCatalogue(setSkus), d.pos.subscribeStock(storeId, setStock), d.pos.subscribePromotions(setPromotions)];
    (async () => {
      try {
        const st = await d.masters.get('stores', storeId);
        const g = st ? await d.masters.get('gstins', String((st as Record<string, unknown>).gstinId)) : null;
        setStoreInfo({ id: storeId, name: String(st?.name ?? storeId), city: (st as Record<string, any> | null)?.city, mall: (st as Record<string, any> | null)?.mall, gstin: (g as Record<string, any> | null)?.gstin, state: (st as Record<string, any> | null)?.state });
      } catch { setStoreInfo({ id: storeId, name: storeId }); }
    })();
    return () => offs.forEach((f) => f());
  }, [session, storeId, setSkus, setStock, setPromotions, setStoreInfo]);
  React.useEffect(() => {
    if (!session || !shiftId) { setShift(null); return; }
    return data().pos.subscribeShift(shiftId, (s) => setShift(s));
  }, [session, shiftId, setShift]);
}

/** Outbox status for the current till: queued-offline, syncing, recently synced. */
export function useOutbox() {
  const tillId = usePos((s) => s.tillId); const session = usePos((s) => s.session); const storeId = usePos((s) => s.storeId);
  const [rows, setRows] = React.useState<PosOutboxRow[]>([]);
  React.useEffect(() => { if (!session || !tillId || !storeId) return; return data().pos.subscribeOutbox(storeId, tillId, setRows); }, [session, tillId, storeId]);
  return rows;
}

export function useGuard(opts: { needShift?: boolean } = {}) {
  const router = useRouter(); const { session, ready, shiftId, shift, storeId } = usePos();
  React.useEffect(() => {
    if (!ready) return;
    if (!session || !storeId) { router.replace('/login'); return; }
    if (opts.needShift && (!shiftId || (shift && shift.status !== 'open'))) router.replace('/shift');
  }, [ready, session, storeId, shiftId, shift, opts.needShift, router]);
  return { ok: ready && !!session && !!storeId && (!opts.needShift || (!!shiftId && (!shift || shift.status === 'open'))) };
}

export function StatusPill() {
  const offline = useIsOffline(); const forced = usePos((s) => s.offlineForced);
  const rows = useOutbox();
  const pending = rows.filter((r) => r.status === 'pending');
  const queued = pending.filter((r) => r.unsynced).length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <span className={cn('inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-semibold', offline ? 'bg-butter text-ink' : 'bg-mint text-ink')} data-testid="net-status">
        {offline ? <WifiOff className="size-3.5" /> : <Cloud className="size-3.5" />}{offline ? (forced ? 'Offline mode (demo)' : 'No connection') : 'Online'}
      </span>
      {pending.length > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-pill bg-lavender px-3 py-1.5 text-xs font-semibold" data-testid="outbox-pill">
          {offline || queued ? <CloudOff className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}{pending.length} sale{pending.length > 1 ? 's' : ''} {offline || queued ? 'waiting to sync' : 'syncing…'}
        </span>
      )}
      {failed > 0 && <span className="rounded-pill bg-cherry px-3 py-1.5 text-xs font-semibold text-cherry-ink">{failed} failed — see History</span>}
    </div>
  );
}

const NAV = [
  { href: '/sell', label: 'Sell', icon: ReceiptIcon }, { href: '/returns', label: 'Returns', icon: RotateCcw }, { href: '/parked', label: 'Parked', icon: PauseCircle },
  { href: '/history', label: 'Bills', icon: History }, { href: '/z-report', label: 'Z-report', icon: FileText },
];

export function TopBar({ children }: { children?: React.ReactNode }) {
  const path = usePathname(); const router = useRouter();
  const { storeInfo, session, offlineForced, tillId, shift } = usePos();
  const toggleOffline = async () => {
    const next = !offlineForced;
    usePos.getState().setOfflineForced(next);
    try { await data().pos.setNetwork(!next); } catch { /* ignore */ }
    toast(next ? 'Offline mode ON — sales are queued in the outbox' : 'Back online — queued sales are syncing', next ? 'info' : 'ok');
  };
  const signOut = async () => { await data().auth.signOut(); usePos.getState().setTill(null, null); router.replace('/login'); };
  return (
    <header className="glass sticky top-0 z-30 flex h-16 items-center gap-3 px-4 print:hidden">
      <Link href="/sell" className="flex items-center gap-2"><Bear size={36} /><div className="leading-tight"><div className="font-display text-base">{storeInfo?.name ?? 'Texa Fashions POS'}</div><div className="text-[11px] text-soft">{tillId ?? 'No till'} · {shift?.shiftNo ?? 'No shift'} · {session?.name}</div></div></Link>
      <nav className="ml-3 flex items-center gap-1">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={cn('flex items-center gap-1.5 rounded-pill px-3 py-2 text-sm font-medium transition', path === n.href ? 'bg-blush' : 'hover:bg-card2')}><n.icon className="size-4" />{n.label}</Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <StatusPill />
        <button onClick={toggleOffline} data-testid="offline-toggle" aria-pressed={offlineForced} className={cn('flex items-center gap-1.5 rounded-pill border px-3 py-2 text-xs font-semibold transition', offlineForced ? 'border-ink bg-ink text-bg' : 'border-line bg-card')}><WifiOff className="size-3.5" />Offline demo</button>
        <a href="/customer-display" target="uni-customer-display" className="grid size-10 place-items-center rounded-full bg-card shadow-soft" title="Open customer display"><Monitor className="size-4" /></a>
        <button onClick={signOut} className="grid size-10 place-items-center rounded-full bg-card shadow-soft" title="Sign out" aria-label="Sign out"><LogOut className="size-4" /></button>
      </div>
    </header>
  );
}

export function Page({ children, needShift = true, header }: { children: React.ReactNode; needShift?: boolean; header?: React.ReactNode }) {
  useBoot();
  const { ok } = useGuard({ needShift });
  if (!ok) return <div className="grid min-h-dvh place-items-center"><MascotLoader label="Opening the till…" /></div>;
  return (
    <div className="flex h-dvh flex-col">
      <TopBar>{header}</TopBar>
      <motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-0 flex-1">{children}</motion.main>
      <FlyLayer /><ConfettiLayer />
    </div>
  );
}
