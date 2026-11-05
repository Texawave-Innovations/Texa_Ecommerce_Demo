'use client';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Banknote, QrCode, Search, Ticket, Undo2 } from 'lucide-react';
import { Badge, Button, Card, Select, cn, toast } from '@texafashions/ui';
import type { SaleDoc } from '@texafashions/types';
import { Page } from '@/components/Shell';
import { ManagerPinDialog } from '@/components/ManagerPin';
import { data } from '@/lib/data';
import { useIsOffline, usePos } from '@/lib/store';
import { fmtDateTime, inr } from '@/lib/stores';

export default function ReturnsPage() { return <Page><React.Suspense fallback={null}><Returns /></React.Suspense></Page>; }

const FALLBACK_REASONS = [{ code: 'RC-RET-DEF', name: 'Defective product', needsApproval: false }, { code: 'RC-RET-CHG', name: 'Changed mind', needsApproval: true }, { code: 'RC-RET-WRG', name: 'Wrong item / size', needsApproval: false }];
const LIMIT_PAISE = 500_000; const WINDOW_DAYS = 7;

function Returns() {
  const router = useRouter(); const sp = useSearchParams(); const { storeId, tillId, shiftId } = usePos(); const offline = useIsOffline();
  const [ref, setRef] = React.useState(sp.get('sale') ?? ''); const [sale, setSale] = React.useState<SaleDoc | null>(null);
  const [qty, setQty] = React.useState<Record<string, number>>({}); const [reason, setReason] = React.useState<Record<string, string>>({});
  const [mode, setMode] = React.useState<'CASH' | 'CN' | 'ORIGINAL'>('CASH'); const [pinOpen, setPinOpen] = React.useState(false); const [busy, setBusy] = React.useState(false);
  const [pin, setPin] = React.useState<string | undefined>();
  const [done, setDone] = React.useState<{ refundPaise: number; returnNo?: string; creditNoteId?: string; balancePaise?: number } | null>(null);
  const recent = useQuery({ queryKey: ['recent', storeId], queryFn: () => data().pos.recentSales(storeId!, 12), enabled: !!storeId && !offline });
  const reasons = useQuery({ queryKey: ['reasons'], queryFn: async () => (await data().masters.list('reasonCodes')).filter((r) => (r as Record<string, unknown>).context === 'pos_return').map((r) => ({ code: r.code as string, name: r.name as string, needsApproval: !!(r as Record<string, unknown>).needsApproval })) });
  const rs = reasons.data?.length ? reasons.data : FALLBACK_REASONS;

  const find = React.useCallback(async (r: string) => {
    if (!storeId || !r.trim()) return;
    try { const s = await data().pos.findSale(r.trim(), storeId); if (!s) { toast('Bill not found in this store', 'err'); return; } setSale(s); setQty({}); setReason({}); setDone(null); setPin(undefined); }
    catch (e) { toast((e as Error).message, 'err'); }
  }, [storeId]);
  React.useEffect(() => { const s = sp.get('sale'); if (s) find(s); }, [sp, find]);

  const picked = sale ? sale.lines.filter((l) => (qty[l.lineId] ?? 0) > 0) : [];
  const refund = picked.reduce((a, l) => {
    const q = qty[l.lineId]!; const left = l.qty - l.returnedQty;
    return a + (q >= left ? l.netPaise - l.refundedPaise : Math.round((l.netPaise * q) / l.qty));
  }, 0);
  const needsMgr = !!sale && (picked.some((l) => rs.find((r) => r.code === reason[l.lineId])?.needsApproval) || refund > LIMIT_PAISE || Date.now() - Date.parse(sale.createdAt) > WINDOW_DAYS * 86_400_000);
  const ready = picked.length > 0 && picked.every((l) => reason[l.lineId]);

  const submit = async (managerPin?: string) => {
    if (!sale || !storeId || !tillId || !shiftId) return; setBusy(true);
    try {
      const r = (await data().pos.command('processReturn', { saleId: sale.id, storeId, tillId, shiftId, lines: picked.map((l) => ({ lineId: l.lineId, qty: qty[l.lineId]!, reasonCode: reason[l.lineId]! })), refundMode: mode, managerPin: managerPin ?? pin ?? null })) as Record<string, any>;
      const cn = r.creditNote as { id: string; balancePaise: number } | undefined;
      setDone({ refundPaise: r.refundPaise ?? refund, returnNo: r.returnNo, creditNoteId: cn?.id ?? r.creditNoteId, balancePaise: cn?.balancePaise ?? r.refundPaise });
      toast('Return processed', 'ok');
    } catch (e) { toast((e as Error).message.replace(/^.*(failed-precondition|permission-denied|invalid-argument):?\s*/i, ''), 'err'); } finally { setBusy(false); }
  };
  const go = () => { if (needsMgr && !pin) setPinOpen(true); else submit(); };

  if (done) {
    return (
      <div className="grid h-full place-items-center p-6"><Card className="w-full max-w-md space-y-4 text-center" data-testid="return-done">
        <Undo2 className="mx-auto size-12 text-emerald-600" /><h2 className="font-display text-3xl">Refund {inr(done.refundPaise)}</h2>
        <p className="text-sm text-soft">{done.returnNo ? `Return ${done.returnNo}` : 'Return recorded'} · {mode === 'CASH' ? 'Hand the cash back to the customer' : mode === 'CN' ? 'Store credit issued' : 'Original tenders reversed'}</p>
        {done.creditNoteId && <div className="rounded-3xl bg-lavender/50 p-4"><div className="text-xs text-soft">Credit note</div><div className="font-mono text-lg" data-testid="cn-id">{done.creditNoteId}</div><div className="font-display text-2xl">{inr(done.balancePaise ?? 0)}</div></div>}
        <div className="flex gap-2">{done.creditNoteId && <Button className="flex-1" onClick={() => { usePos.getState().addInstrument({ kind: 'CN', id: done.creditNoteId!, balancePaise: done.balancePaise ?? 0 }); router.push('/sell'); }} data-testid="exchange-go"><ArrowRightLeft className="size-4" />Exchange — new bill</Button>}<Button variant="outline" className="flex-1" onClick={() => { setSale(null); setDone(null); setRef(''); }}>Done</Button></div>
      </Card></div>
    );
  }

  return (
    <div className="mx-auto grid h-full max-w-6xl gap-5 overflow-auto p-5 md:grid-cols-[1fr_1.4fr]">
      <section className="space-y-4">
        <h2 className="font-display text-2xl">Returns &amp; exchanges</h2>
        {offline && <p className="rounded-2xl bg-butter/60 p-3 text-sm">Returns need a connection (refunds, credit notes and stock are updated server-side).</p>}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); find(ref); }}>
          <label className="flex h-12 flex-1 items-center gap-2 rounded-pill border border-line bg-card px-4"><QrCode className="size-4 text-soft" /><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Scan bill QR or type invoice no." data-testid="return-ref" autoFocus className="h-full flex-1 bg-transparent outline-none" /></label>
          <Button type="submit" size="lg" data-testid="return-find"><Search className="size-4" />Find</Button>
        </form>
        <div className="space-y-2"><div className="text-xs font-semibold uppercase tracking-wide text-soft">Recent bills</div>
          {recent.data?.map((s) => (
            <button key={s.id} onClick={() => { setSale(s); setQty({}); setReason({}); setPin(undefined); }} className={cn('flex w-full items-center justify-between rounded-2xl border bg-card p-3 text-left text-sm active:scale-[.99]', sale?.id === s.id ? 'border-cherry' : 'border-line')} data-testid="recent-bill">
              <span><b>{s.invoiceNo}</b><span className="block text-xs text-soft">{fmtDateTime(s.createdAt)} · {s.customer?.name ?? 'Walk-in'}</span></span><span className="flex items-center gap-2">{s.status !== 'completed' && <Badge tone="butter">{s.status.replace('_', ' ')}</Badge>}<b>{inr(s.payablePaise)}</b></span>
            </button>
          ))}
        </div>
      </section>
      <section>
        {!sale ? <Card className="grid h-64 place-items-center text-center text-soft">Find a bill to start a return or exchange.</Card> : (
          <Card className="space-y-4" data-testid="return-sale">
            <div className="flex items-start justify-between"><div><div className="font-display text-xl">{sale.invoiceNo}</div><div className="text-xs text-soft">{fmtDateTime(sale.createdAt)} · {sale.customer?.name ?? 'Walk-in'} · {inr(sale.payablePaise)}</div></div><Badge tone={sale.status === 'completed' ? 'mint' : 'butter'}>{sale.status.replace('_', ' ')}</Badge></div>
            {sale.status === 'voided' && <p className="rounded-2xl bg-cherry/10 p-3 text-sm text-cherry">This bill was voided.</p>}
            <div className="space-y-2">
              {sale.lines.map((l) => {
                const left = l.qty - l.returnedQty; const q = qty[l.lineId] ?? 0;
                return (
                  <div key={l.lineId} className={cn('rounded-2xl border p-3', q > 0 ? 'border-cherry bg-blush/20' : 'border-line')} data-testid="return-line">
                    <div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="truncate text-sm font-medium">{l.name}</div><div className="text-xs text-soft">Sold {l.qty} · returned {l.returnedQty} · paid {inr(l.netPaise)}</div></div>
                      {left > 0 && sale.status !== 'voided' ? <div className="flex items-center gap-1"><button className="grid size-8 place-items-center rounded-full bg-card shadow-soft" onClick={() => setQty({ ...qty, [l.lineId]: Math.max(0, q - 1) })} aria-label="Less">−</button><b className="w-6 text-center" data-testid="ret-qty">{q}</b><button className="grid size-8 place-items-center rounded-full bg-card shadow-soft" onClick={() => setQty({ ...qty, [l.lineId]: Math.min(left, q + 1) })} aria-label="More" data-testid="ret-plus">+</button></div> : <Badge tone="butter">{left === 0 ? 'Fully returned' : 'n/a'}</Badge>}
                    </div>
                    {q > 0 && <Select className="mt-2" value={reason[l.lineId] ?? ''} onChange={(e) => setReason({ ...reason, [l.lineId]: e.target.value })} data-testid="ret-reason"><option value="">Reason…</option>{rs.map((r) => <option key={r.code} value={r.code}>{r.name}{r.needsApproval ? ' (manager)' : ''}</option>)}</Select>}
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([['CASH', 'Cash back', Banknote], ['CN', 'Credit note / exchange', Ticket], ['ORIGINAL', 'Original tender', Undo2]] as const).map(([m, label, Icon]) => (
                <button key={m} onClick={() => setMode(m)} data-testid={`refund-${m}`} className={cn('flex flex-col items-center gap-1 rounded-2xl border p-3 text-xs font-semibold transition active:scale-95', mode === m ? 'border-cherry bg-blush/50' : 'border-line bg-card')}><Icon className="size-5" />{label}</button>
              ))}
            </div>
            <div className="flex items-center justify-between"><div><div className="text-xs text-soft">Refund</div><div className="font-display text-3xl" data-testid="refund-amount">{inr(refund)}</div></div>
              <Button size="lg" onClick={go} loading={busy} disabled={!ready || offline || sale.status === 'voided'} data-testid="return-submit">{needsMgr && !pin ? 'Manager approval' : 'Process return'}</Button></div>
            {needsMgr && <p className="text-xs text-soft">Manager PIN needed: {refund > LIMIT_PAISE ? 'refund above ₹5,000 · ' : ''}reason policy or bill older than {WINDOW_DAYS} days.</p>}
          </Card>
        )}
      </section>
      <ManagerPinDialog open={pinOpen} onClose={() => setPinOpen(false)} reason="This return needs a manager's approval." onApproved={(p) => { setPin(p); submit(p); }} />
    </div>
  );
}
