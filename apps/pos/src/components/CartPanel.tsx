'use client';
import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Gift, Minus, PauseCircle, Percent, Plus, ShoppingBag, Sparkles, Tag, Trash2, UserRound, X } from 'lucide-react';
import { Badge, Button, Dialog, cn, toast } from '@texafashions/ui';
import { SERVICE_GIFTWRAP_SKU } from '@texafashions/types';
import type { Voucher } from '@texafashions/domain';
import { data } from '@/lib/data';
import { useIsOffline, usePos } from '@/lib/store';
import { usePricing } from '@/lib/cart';
import { mgr } from '@/lib/mgr';
import { inr } from '@/lib/stores';
import { CustomerDialog } from './CustomerDialog';
import { ManagerPinDialog } from './ManagerPin';

export function CartPanel({ onPay, onPark }: { onPay: () => void; onPark: () => void }) {
  const { cart, skus, customer, voucher, setQty, removeLine, setManual, setVoucher, resetSale, addSku } = usePos();
  const pricing = usePricing();
  const offline = useIsOffline();
  const [custOpen, setCustOpen] = React.useState(false);
  const [discLine, setDiscLine] = React.useState<string | null>(null);
  const [pinOpen, setPinOpen] = React.useState(false);
  const [code, setCode] = React.useState('');
  const skuMap = React.useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const wrapSku = skuMap.get(SERVICE_GIFTWRAP_SKU);
  const wrapLine = cart.find((l) => l.skuId === SERVICE_GIFTWRAP_SKU);
  const { result, invoice } = pricing;

  const applyVoucher = async () => {
    const c = code.trim().toUpperCase(); if (!c) return;
    try {
      const v = await data().pos.getVoucher(c);
      if (!v) { toast('Voucher not found', 'err'); return; }
      setVoucher(v as unknown as Voucher); setCode('');
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const pricedById = new Map(result.lines.map((l) => [l.lineId, l]));

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-[28px] border border-line/60 bg-card shadow-soft" aria-label="Current bill">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <div className="flex items-center gap-2"><span id="cart-badge" className="relative grid size-9 place-items-center rounded-full bg-blush"><ShoppingBag className="size-4" /><span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-cherry px-1 text-[11px] font-bold text-cherry-ink" data-testid="cart-count">{pricing.itemCount}</span></span><h2 className="font-display text-lg">Current bill</h2></div>
        <button onClick={() => setCustOpen(true)} data-testid="customer-btn" className={cn('flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-semibold transition active:scale-95', customer ? 'bg-lavender' : 'bg-card2')}>
          <UserRound className="size-3.5" />{customer ? customer.name.split(' ')[0] : 'Add customer'}
        </button>
      </div>
      {customer && (
        <div className="mx-4 mb-2 flex items-center justify-between rounded-2xl bg-lavender/40 px-3 py-1.5 text-xs">
          <span><b>{customer.name}</b> · {customer.mobile}</span>
          <span className="flex items-center gap-2"><Badge tone="butter">{customer.tierId ?? 'CUTIE'}</Badge><span className="flex items-center gap-1"><Gift className="size-3" />{customer.pointsBalance}</span><button onClick={() => usePos.getState().setCustomer(null)} aria-label="Remove customer"><X className="size-3.5" /></button></span>
        </div>
      )}

      <div className="scroll-y min-h-0 flex-1 px-3" data-testid="cart-lines">
        {!cart.length && <div className="grid h-full place-items-center px-6 text-center text-sm text-soft"><div><ShoppingBag className="mx-auto mb-2 size-8 opacity-40" />Scan or tap items to start a bill</div></div>}
        <AnimatePresence initial={false}>
          {cart.map((l) => {
            const s = skuMap.get(l.skuId); const pl = pricedById.get(l.lineId); if (!s || !pl) return null;
            const isSvc = !!s.isService;
            return (
              <motion.div key={l.lineId} layout initial={{ opacity: 0, x: 30, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                className="mb-2 rounded-2xl border border-line/60 bg-bg p-2.5" data-testid="cart-line">
                <div className="flex items-start gap-2">
                  {s.imageUrl ? <img src={s.imageUrl} alt="" className="size-11 shrink-0 rounded-xl object-cover" /> : <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-butter"><Gift className="size-5" /></span>}
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[13px] font-medium leading-snug">{s.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">{pl.allocations.map((a) => <span key={a.promoId} className="rounded-pill bg-mint/60 px-2 py-0.5 text-[10px] font-semibold">{a.name.length > 22 ? `${a.name.slice(0, 20)}…` : a.name} −{inr(a.amountPaise)}</span>)}</div>
                  </div>
                  <div className="text-right"><div className="font-display text-base" data-testid="line-net">{inr(pl.netPaise)}</div>{pl.discountPaise > 0 && <div className="text-[11px] text-soft line-through">{inr(pl.grossPaise)}</div>}</div>
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setQty(l.lineId, l.qty - 1)} aria-label="Decrease" className="grid size-8 place-items-center rounded-full bg-card shadow-soft active:scale-90"><Minus className="size-3.5" /></button>
                    <span className="w-8 text-center font-semibold" data-testid="line-qty">{l.qty}</span>
                    <button onClick={() => setQty(l.lineId, l.qty + 1)} aria-label="Increase" className="grid size-8 place-items-center rounded-full bg-card shadow-soft active:scale-90"><Plus className="size-3.5" /></button>
                  </div>
                  <div className="flex items-center gap-1">
                    {!isSvc && !offline && <button onClick={() => { setDiscLine(l.lineId); setPinOpen(true); }} aria-label="Manager discount" title="Manager discount" className="grid size-8 place-items-center rounded-full text-soft hover:bg-card"><Percent className="size-3.5" /></button>}
                    <button onClick={() => removeLine(l.lineId)} aria-label="Remove" className="grid size-8 place-items-center rounded-full text-soft hover:bg-card"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
              </motion.div>
            );
          })}
          {result.lines.filter((l) => l.isFreeGift).map((l) => (
            <motion.div key={l.lineId} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mb-2 flex items-center gap-2 rounded-2xl border border-dashed border-cherry/50 bg-blush/30 p-2.5 text-sm"><Gift className="size-5 text-cherry" /><span className="flex-1">{l.name}</span><b>FREE</b></motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="space-y-2 border-t border-line/60 p-3">
        {result.nudges.slice(0, 2).map((n) => (
          <motion.div key={n.promoId} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 rounded-2xl bg-butter/70 px-3 py-2 text-xs font-medium" data-testid="nudge"><Sparkles className="size-3.5 shrink-0 text-cherry" />{n.message}</motion.div>
        ))}
        {result.voucherError && <div className="rounded-2xl bg-cherry/10 px-3 py-2 text-xs font-medium text-cherry" role="alert">{result.voucherError}</div>}
        <div className="flex gap-2">
          {voucher ? (
            <div className="flex flex-1 items-center justify-between rounded-pill bg-mint/50 px-3 py-1.5 text-xs font-semibold"><span className="flex items-center gap-1.5"><Tag className="size-3.5" />{voucher.code}</span><button onClick={() => setVoucher(null)} aria-label="Remove voucher"><X className="size-3.5" /></button></div>
          ) : (
            <form className="flex flex-1 items-center gap-1 rounded-pill border border-line bg-bg pl-3" onSubmit={(e) => { e.preventDefault(); applyVoucher(); }}>
              <Tag className="size-3.5 text-soft" /><input value={code} onChange={(e) => setCode(e.target.value)} placeholder={offline ? 'Vouchers need a connection' : 'Voucher code'} disabled={offline || !cart.length} data-testid="voucher-input" className="h-9 min-w-0 flex-1 bg-transparent text-xs uppercase outline-none" />
              <button type="submit" disabled={offline || !code.trim()} className="m-0.5 rounded-pill bg-ink px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-40">Apply</button>
            </form>
          )}
          {wrapSku && <button onClick={() => (wrapLine ? removeLine(wrapLine.lineId) : addSku(wrapSku, 1))} data-testid="giftwrap" className={cn('flex items-center gap-1 rounded-pill px-3 py-1.5 text-xs font-semibold transition active:scale-95', wrapLine ? 'bg-cherry text-cherry-ink' : 'bg-card2')}><Gift className="size-3.5" />Wrap {inr(wrapSku.pricePaise)}</button>}
        </div>

        <div className="space-y-0.5 text-sm">
          <Row l="Subtotal" v={inr(invoice.grossPaise)} />
          {result.applied.map((a) => <Row key={a.promoId} l={a.name} v={`−${inr(a.amountPaise)}`} tone="text-emerald-700" />)}
          {invoice.roundOffPaise !== 0 && <Row l="Round off" v={`${invoice.roundOffPaise > 0 ? '+' : '−'}${inr(Math.abs(invoice.roundOffPaise))}`} tone="text-soft" />}
        </div>
        <div className="flex items-end justify-between">
          <div><div className="text-xs text-soft">To pay</div>{pricing.savingsPaise > 0 && <div className="text-xs font-semibold text-emerald-700">You save {inr(pricing.savingsPaise)}</div>}</div>
          <motion.div key={invoice.payablePaise} initial={{ scale: 1.12 }} animate={{ scale: 1 }} className="font-display text-4xl" data-testid="cart-total">{inr(invoice.payablePaise)}</motion.div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="lg" onClick={onPark} disabled={!cart.length} aria-label="Park bill" data-testid="park-btn"><PauseCircle className="size-4" />Park</Button>
          <Button variant="outline" size="lg" onClick={() => { resetSale(); mgr.pin = undefined; }} disabled={!cart.length} aria-label="Clear bill"><Trash2 className="size-4" /></Button>
          <Button size="lg" className="flex-1 text-lg" onClick={onPay} disabled={!cart.length || invoice.payablePaise <= 0} data-testid="pay-btn">Pay {inr(invoice.payablePaise)}</Button>
        </div>
      </div>

      <CustomerDialog open={custOpen} onClose={() => setCustOpen(false)} />
      <ManagerPinDialog open={pinOpen} onClose={() => { setPinOpen(false); }} reason="Line discounts above the shelf price need a manager's PIN." onApproved={(pin, m) => { mgr.pin = pin; mgr.name = m.managerName; }} />
      <DiscountDialog open={!!discLine && !pinOpen && !!mgr.pin} line={discLine} onClose={() => setDiscLine(null)} onApply={(paise, reason) => { if (discLine) setManual(discLine, paise, reason, mgr.name); setDiscLine(null); }} gross={discLine ? pricedById.get(discLine)?.grossPaise ?? 0 : 0} />
    </aside>
  );
}
const Row = ({ l, v, tone }: { l: string; v: string; tone?: string }) => <div className={cn('flex justify-between', tone)}><span className="truncate pr-2">{l}</span><span className="num">{v}</span></div>;

function DiscountDialog({ open, line, onClose, onApply, gross }: { open: boolean; line: string | null; onClose: () => void; onApply: (paise: number, reason: string) => void; gross: number }) {
  void line;
  const reasons = [['RC-DISC-MGR', 'Manager discretion']];
  return (
    <Dialog open={open} onClose={onClose} title="Manager discount">
      <div className="space-y-3">
        <p className="text-sm text-soft">Line value {inr(gross)}. Choose a discount:</p>
        <div className="grid grid-cols-4 gap-2">{[5, 10, 15, 20].map((p) => <Button key={p} variant="soft" onClick={() => onApply(Math.round((gross * p) / 100), reasons[0]![0]!)} data-testid={`disc-${p}`}>{p}%</Button>)}</div>
        <p className="text-xs text-soft">Reason: {reasons[0]![1]} · logged to the audit trail.</p>
      </div>
    </Dialog>
  );
}
