'use client';
import * as React from 'react';
import { toast } from '@texafashions/ui';
import { crossSell } from '@texafashions/domain';
import type { SaleDoc } from '@texafashions/types';
import { CartPanel } from '@/components/CartPanel';
import { CrossSellStrip, ProductGrid } from '@/components/ProductGrid';
import { SaleDone } from '@/components/SaleDone';
import { ScanDialog } from '@/components/ScanDialog';
import { Page } from '@/components/Shell';
import { TenderDialog } from '@/components/TenderDialog';
import { data } from '@/lib/data';
import { usePricing } from '@/lib/cart';
import { fireConfetti, flyBus, onDisplay, sendDisplay } from '@/lib/events';
import { mgr } from '@/lib/mgr';
import { submitSale } from '@/lib/sale';
import { newId, useIsOffline, usePos } from '@/lib/store';
import { inr } from '@/lib/stores';

export default function SellPage() { return <Page><Sell /></Page>; }

function Sell() {
  const pricing = usePricing();
  const offline = useIsOffline();
  const { cart, skus, customer, storeInfo, startedAt } = usePos();
  const searchRef = React.useRef<HTMLInputElement>(null);
  const [tenderOpen, setTenderOpen] = React.useState(false);
  const [scanOpen, setScanOpen] = React.useState(false);
  const [completing, setCompleting] = React.useState(false);
  const [done, setDone] = React.useState<{ sale: SaleDoc; provisional: boolean; tookMs: number } | null>(null);
  const pricingRef = React.useRef(pricing); pricingRef.current = pricing;
  const skuMap = React.useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  // ───── customer display mirror
  React.useEffect(() => {
    const lines = pricing.result.lines.map((l) => ({ name: l.name, qty: l.qty, netPaise: l.netPaise, grossPaise: l.grossPaise, free: l.isFreeGift }));
    const nudge = pricing.result.nudges[0]?.message;
    const msg = { type: 'state' as const, lines, netPaise: pricing.invoice.netPaise, payablePaise: pricing.invoice.payablePaise, savingsPaise: pricing.savingsPaise, nudge, customer: customer?.name, applied: pricing.result.applied.map((a) => ({ name: a.name, amountPaise: a.amountPaise })), storeName: storeInfo?.name };
    if (!done && !tenderOpen) sendDisplay(cart.length ? msg : { type: 'idle' });
    return onDisplay((m) => { if (m.type === 'hello' && !done && !tenderOpen) sendDisplay(cart.length ? msg : { type: 'idle' }); });
  }, [pricing, cart.length, customer, storeInfo, done, tenderOpen]);

  const finish = React.useCallback(async () => {
    if (completing) return; setCompleting(true);
    const p = pricingRef.current; const started = usePos.getState().startedAt ?? Date.now();
    try {
      const out = await submitSale({ result: p.result, invoice: p.invoice, changePaise: p.changePaise }, offline, mgr.pin);
      const tookMs = Date.now() - started;
      setTenderOpen(false); setDone({ sale: out.sale, provisional: out.provisional, tookMs });
      fireConfetti(true);
      sendDisplay({ type: 'done', invoiceNo: out.sale.invoiceNo, savingsPaise: out.sale.discountPaise, points: out.sale.pointsEarned, payablePaise: out.sale.payablePaise, provisional: out.provisional });
    } catch (e) {
      const msg = (e as Error).message ?? 'Sale failed';
      if (/price changed/i.test(msg)) toast('Prices or offers changed — bill re-priced. Please take payment again.', 'err'); else toast(msg.replace(/^.*(failed-precondition|permission-denied|invalid-argument):?\s*/i, ''), 'err');
      usePos.getState().clearPayments();
    } finally { setCompleting(false); }
  }, [completing, offline]);

  const newSale = React.useCallback(() => { usePos.getState().resetSale(); mgr.pin = undefined; mgr.name = undefined; setDone(null); sendDisplay({ type: 'idle' }); setTimeout(() => searchRef.current?.focus(), 50); }, []);

  const park = async () => {
    const s = usePos.getState(); if (!s.cart.length || !s.storeId || !s.tillId || !s.session) return;
    const label = s.customer?.name ?? `Bill ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`;
    await data().pos.saveParked({ id: newId(), storeId: s.storeId, tillId: s.tillId, cashierId: s.session.uid, label, customer: s.customer ? { id: s.customer.id, name: s.customer.name, mobile: s.customer.mobile, tierId: s.customer.tierId } : null, lines: s.cart.map((l) => ({ lineId: l.lineId, skuId: l.skuId, qty: l.qty, manualDiscountPaise: l.manualDiscountPaise ?? null, manualReasonCode: l.manualReasonCode ?? null })) });
    toast(`Parked “${label}”`, 'ok'); newSale();
  };

  const suggestions = React.useMemo(() => {
    const cs = cart.map((l) => skuMap.get(l.skuId)).filter((s) => s && !s.isService).map((s) => ({ skuId: s!.id, name: s!.name, pricePaise: s!.pricePaise, character: s!.character, departmentId: s!.departmentId, subCategoryId: s!.subCategoryId }));
    const cat = skus.filter((s) => !s.isService).map((s) => ({ skuId: s.id, name: s.name, pricePaise: s.pricePaise, character: s.character, departmentId: s.departmentId, subCategoryId: s.subCategoryId }));
    return crossSell(cs, cat, 3).map((c) => skuMap.get(c.skuId)!).filter(Boolean);
  }, [cart, skus, skuMap]);

  // refocus the scan box when dialogs close
  React.useEffect(() => { if (!tenderOpen && !scanOpen && !done) setTimeout(() => searchRef.current?.focus(), 80); }, [tenderOpen, scanOpen, done]);
  const elapsed = useElapsed(startedAt);

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_380px] gap-4 p-4" data-testid="sell-screen">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="min-h-0 flex-1"><ProductGrid onScan={() => setScanOpen(true)} searchRef={searchRef} /></div>
        <CrossSellStrip items={suggestions} onAdd={(s, el) => { usePos.getState().addSku(s, 1); flyBus.emit({ from: el.getBoundingClientRect(), image: s.imageUrl }); }} />
      </div>
      <div className="relative min-h-0">
        {startedAt && !done && <div className="absolute -top-3 right-4 z-10 rounded-pill bg-ink px-2.5 py-0.5 text-[11px] font-semibold text-bg" data-testid="sale-timer">⏱ {elapsed}</div>}
        <CartPanel onPay={() => { if (pricing.invoice.payablePaise > 0) setTenderOpen(true); }} onPark={park} />
      </div>
      <TenderDialog open={tenderOpen} onClose={() => setTenderOpen(false)} onComplete={finish} completing={completing} />
      <ScanDialog open={scanOpen} onClose={() => setScanOpen(false)} />
      {done && <SaleDone sale={done.sale} provisional={done.provisional} tookMs={done.tookMs} onNew={newSale} storeName={storeInfo?.name} />}
      <span className="sr-only" aria-live="polite">{cart.length ? `Total ${inr(pricing.invoice.payablePaise)}` : 'Bill empty'}</span>
    </div>
  );
}

function useElapsed(start: number | null) {
  const [n, setN] = React.useState(0);
  React.useEffect(() => { if (!start) return; const t = setInterval(() => setN(Math.floor((Date.now() - start) / 1000)), 500); return () => clearInterval(t); }, [start]);
  if (!start) return '0:00';
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
