'use client';
import * as React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, CloudOff, MessageCircle, Printer, Send, Timer } from 'lucide-react';
import { Button, Input, toast } from '@texafashions/ui';
import { renderEBill } from '@texafashions/domain';
import type { SaleDoc } from '@texafashions/types';
import { data } from '@/lib/data';
import { useIsOffline } from '@/lib/store';
import { inr } from '@/lib/stores';
import { Receipt } from './Receipt';

export function SaleDone({ sale, provisional, tookMs, onNew, storeName }: { sale: SaleDoc; provisional: boolean; tookMs: number; onNew: () => void; storeName?: string }) {
  const offline = useIsOffline();
  const [mobile, setMobile] = React.useState(sale.customer?.mobile ?? '');
  const [sent, setSent] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const secs = Math.round(tookMs / 1000);
  const link = `https://texafashions.in/b/${encodeURIComponent(sale.invoiceNo)}`;
  const body = renderEBill({ customerName: sale.customer?.name, invoiceNo: sale.invoiceNo, storeName: storeName ?? sale.storeName ?? sale.storeId, totalPaise: sale.payablePaise, savedPaise: sale.discountPaise, pointsEarned: sale.pointsEarned, link });
  const send = async () => {
    setBusy(true);
    try {
      if (!offline && !provisional) await data().pos.command('sendEBill', { saleId: sale.id, mobile: /^[6-9]\d{9}$/.test(mobile) ? mobile : null });
      setSent(mobile || sale.customer?.mobile || 'customer'); toast('E-bill sent on WhatsApp (mock)', 'ok');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  React.useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Enter' && document.activeElement?.tagName !== 'INPUT') onNew(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onNew]);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 grid place-items-center bg-bg/85 p-4 backdrop-blur-md print:static print:bg-transparent" data-testid="sale-done">
      <div className="grid max-h-[94dvh] w-full max-w-4xl gap-5 overflow-auto rounded-[32px] bg-card p-6 shadow-pop md:grid-cols-[1fr_auto] print:block print:max-h-none print:shadow-none">
        <div className="flex flex-col items-center justify-center gap-3 text-center print:hidden">
          <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }}><CheckCircle2 className="size-20 text-emerald-600" /></motion.div>
          <h2 className="font-display text-3xl">{provisional ? 'Saved offline' : 'Sale complete!'}</h2>
          <div className="font-display text-5xl" data-testid="done-total">{inr(sale.payablePaise)}</div>
          <div className="text-sm text-soft">Bill <b data-testid="done-invoice">{sale.invoiceNo}</b></div>
          {provisional && <div className="flex items-center gap-2 rounded-2xl bg-butter/70 px-4 py-2 text-sm"><CloudOff className="size-4" />Provisional receipt — the GST invoice number is assigned when this tablet syncs.</div>}
          <div className="flex flex-wrap justify-center gap-2 text-sm">
            <span className="flex items-center gap-1 rounded-pill bg-lavender px-3 py-1.5 font-semibold" data-testid="took"><Timer className="size-4" />{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}{secs <= 45 ? ' ⚡' : ''}</span>
            {sale.discountPaise > 0 && <span className="rounded-pill bg-mint px-3 py-1.5 font-semibold">Saved {inr(sale.discountPaise)}</span>}
            {sale.pointsEarned > 0 && <span className="rounded-pill bg-blush px-3 py-1.5 font-semibold">+{sale.pointsEarned} Uni Points</span>}
            {sale.changeGivenPaise > 0 && <span className="rounded-pill bg-butter px-3 py-1.5 font-semibold" data-testid="done-change">Change {inr(sale.changeGivenPaise)}</span>}
          </div>
          <div className="mt-2 w-full max-w-sm space-y-2">
            <div className="flex gap-2"><Input value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="tel" placeholder="WhatsApp number" data-testid="ebill-mobile" /><Button variant="soft" onClick={send} loading={busy} disabled={!/^[6-9]\d{9}$/.test(mobile)} data-testid="ebill-send"><Send className="size-4" />E-bill</Button></div>
            {sent && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl rounded-bl-md bg-[#dcf8c6] p-3 text-left text-[13px] leading-snug text-black shadow-soft" data-testid="ebill-bubble"><div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-800"><MessageCircle className="size-3" />WhatsApp · {sent} (mock)</div><div className="whitespace-pre-line">{body}</div></motion.div>}
          </div>
          <div className="mt-2 flex gap-2"><Button variant="outline" size="lg" onClick={() => window.print()} data-testid="print-btn"><Printer className="size-4" />Print receipt</Button><Button size="lg" onClick={onNew} data-testid="new-sale">New sale</Button></div>
        </div>
        <div className="scroll-y max-h-[80dvh] justify-self-center print:max-h-none"><Receipt sale={sale} /></div>
      </div>
    </motion.div>
  );
}
