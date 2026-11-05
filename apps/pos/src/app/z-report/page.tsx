'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CloudOff, Lock, Printer } from 'lucide-react';
import { Button, Card, Field, Input, cn, toast } from '@texafashions/ui';
import { INR_DENOMINATIONS, Z_VARIANCE_TOLERANCE_PAISE, countDenominations, zReport, type DenominationCounts } from '@texafashions/domain';
import type { ReturnDoc, SaleDoc, ZReportDoc } from '@texafashions/types';
import { Page, useOutbox } from '@/components/Shell';
import { ManagerPinDialog } from '@/components/ManagerPin';
import { ZReceipt } from '@/components/Receipt';
import { data } from '@/lib/data';
import { useIsOffline, usePos } from '@/lib/store';
import { inr } from '@/lib/stores';

export default function ZPage() { return <Page needShift={false}><Z /></Page>; }

function Z() {
  const router = useRouter(); const { shiftId, shift, storeId } = usePos(); const offline = useIsOffline();
  const [sales, setSales] = React.useState<SaleDoc[]>([]); const [returns, setReturns] = React.useState<ReturnDoc[]>([]);
  const [counts, setCounts] = React.useState<DenominationCounts>({}); const [paidIn, setPaidIn] = React.useState(''); const [paidOut, setPaidOut] = React.useState('');
  const [pinOpen, setPinOpen] = React.useState(false); const [busy, setBusy] = React.useState(false); const [report, setReport] = React.useState<ZReportDoc | null>(null);
  const outbox = useOutbox();
  React.useEffect(() => { if (!shiftId || !storeId) return; const a = data().pos.subscribeSales(storeId, shiftId, setSales); const b = data().pos.subscribeReturns(storeId, shiftId, setReturns); return () => { a(); b(); }; }, [shiftId, storeId]);
  const pending = outbox.filter((o) => o.shiftId === shiftId && o.status === 'pending').length;
  const counted = countDenominations(counts);
  const live = React.useMemo(() => zReport({
    openingFloatPaise: shift?.openingFloatPaise ?? 0, countedCashPaise: counted, paidInPaise: Math.round(Number(paidIn || 0) * 100), paidOutPaise: Math.round(Number(paidOut || 0) * 100),
    sales: sales.map((s) => ({ totals: s.payments.map((p) => ({ mode: p.mode, amountPaise: p.amountPaise })), netPaise: s.payablePaise, discountPaise: s.discountPaise, taxPaise: s.totalTaxPaise, changeGivenPaise: s.changeGivenPaise, voided: s.status === 'voided' })),
    returns: returns.filter((r) => r.kind === 'return').map((r) => ({ refundPaise: r.refundPaise, mode: r.refundMode })),
  }), [sales, returns, shift, counted, paidIn, paidOut]);
  const needsMgr = Math.abs(live.variancePaise) > Z_VARIANCE_TOLERANCE_PAISE;

  const close = async (pin?: string) => {
    if (!shiftId) return; setBusy(true);
    try {
      const r = (await data().pos.command('closeShift', { shiftId, denominations: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v ?? 0])), paidInPaise: Math.round(Number(paidIn || 0) * 100), paidOutPaise: Math.round(Number(paidOut || 0) * 100), managerPin: pin ?? null })) as { zReport?: ZReportDoc } & Partial<ZReportDoc>;
      const z = (r.zReport ?? r) as ZReportDoc;
      setReport(z); usePos.getState().setTill(null, null); toast('Shift closed', 'ok');
    } catch (e) { toast((e as Error).message.replace(/^.*(failed-precondition|permission-denied):?\s*/i, ''), 'err'); } finally { setBusy(false); }
  };

  if (!report && !shiftId) return <div className="grid h-full place-items-center p-6"><Card className="max-w-sm space-y-3 text-center"><Lock className="mx-auto size-10 text-soft" /><h2 className="font-display text-2xl">No open shift</h2><Button onClick={() => router.replace('/shift')}>Open a shift</Button></Card></div>;
  if (report) {
    return (
      <div className="mx-auto grid h-full max-w-4xl gap-6 overflow-auto p-6 md:grid-cols-[1fr_auto]">
        <div className="flex flex-col items-center justify-center gap-4 text-center print:hidden"><Lock className="size-14 text-emerald-600" /><h2 className="font-display text-3xl">Shift closed</h2><p className="text-soft">Variance {report.variancePaise === 0 ? 'nil — drawer balances 🎉' : inr(report.variancePaise)}</p>
          <div className="flex gap-2"><Button variant="outline" size="lg" onClick={() => window.print()} data-testid="print-z"><Printer className="size-4" />Print Z-report</Button><Button size="lg" onClick={async () => { await data().auth.signOut(); router.replace('/login'); }} data-testid="z-signout">Sign out</Button></div></div>
        <div className="justify-self-center"><ZReceipt z={report} /></div>
      </div>
    );
  }
  const row = (l: string, v: number, strong = false) => <div className={cn('flex justify-between py-1', strong && 'border-t border-line pt-2 font-semibold')}><span>{l}</span><span className="num">{inr(v)}</span></div>;
  return (
    <div className="mx-auto grid h-full max-w-5xl gap-5 overflow-auto p-5 md:grid-cols-[1fr_1.1fr]">
      <Card className="space-y-1">
        <h2 className="mb-2 font-display text-2xl">Z-report · {shift?.shiftNo}</h2>
        <div className="flex justify-between py-1"><span>Bills</span><b>{live.billCount}</b></div>
        {row('Gross sales', live.grossSalesPaise)}{row('Discounts', -live.discountPaise)}{row('GST collected', live.taxPaise)}{row('Returns / voids', -live.returnsPaise)}{row('Net sales', live.netSalesPaise, true)}
        <div className="pt-3 text-xs font-semibold uppercase tracking-wide text-soft">By tender</div>
        {Object.entries(live.byTender).map(([k, v]) => <div key={k} className="flex justify-between py-0.5 text-sm"><span>{k}</span><span className="num">{inr(v)}</span></div>)}
        <div className="pt-3 text-xs font-semibold uppercase tracking-wide text-soft">Cash drawer</div>
        {row('Opening float', shift?.openingFloatPaise ?? 0)}{row('Cash sales (net of change)', live.cashSalesPaise)}{row('Cash refunds', -live.cashRefundsPaise)}{row('Expected in drawer', live.expectedCashPaise, true)}
      </Card>
      <Card className="space-y-3">
        <h3 className="font-display text-xl">Count the drawer</h3>
        <div className="grid grid-cols-3 gap-2">
          {INR_DENOMINATIONS.map((d) => (
            <label key={d} className="rounded-2xl border border-line bg-card p-2 text-center text-sm"><span className="mb-1 block font-semibold">₹{d}</span>
              <input inputMode="numeric" value={counts[d] ?? ''} placeholder="0" onChange={(e) => setCounts({ ...counts, [d]: Number(e.target.value.replace(/\D/g, '') || 0) })} data-testid={`denom-${d}`} className="h-10 w-full rounded-xl bg-card2 text-center text-lg outline-none focus:ring-2 focus:ring-cherry" /></label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2"><Field label="Paid in (₹)"><Input inputMode="numeric" value={paidIn} onChange={(e) => setPaidIn(e.target.value.replace(/\D/g, ''))} /></Field><Field label="Paid out (₹)"><Input inputMode="numeric" value={paidOut} onChange={(e) => setPaidOut(e.target.value.replace(/\D/g, ''))} /></Field></div>
        <div className="space-y-1 rounded-3xl bg-card2 p-4"><div className="flex justify-between"><span>Counted</span><b className="num" data-testid="counted">{inr(counted)}</b></div>
          <div className={cn('flex justify-between text-lg font-semibold', live.variancePaise === 0 ? 'text-emerald-700' : 'text-cherry')}><span>Variance</span><span className="num" data-testid="variance">{live.variancePaise > 0 ? '+' : ''}{inr(live.variancePaise)}</span></div></div>
        {pending > 0 && <p className="flex items-center gap-2 rounded-2xl bg-butter/70 p-3 text-sm" data-testid="z-blocked"><CloudOff className="size-4 shrink-0" />{pending} offline sale{pending > 1 ? 's' : ''} not yet synced — reconnect so they can be finalised before closing the shift.</p>}
        {needsMgr && <p className="flex items-center gap-2 rounded-2xl bg-cherry/10 p-3 text-sm text-cherry"><AlertTriangle className="size-4 shrink-0" />Variance above {inr(Z_VARIANCE_TOLERANCE_PAISE)} — manager sign-off needed.</p>}
        <Button size="lg" className="w-full" loading={busy} disabled={pending > 0 || offline || counted === 0} onClick={() => (needsMgr ? setPinOpen(true) : close())} data-testid="close-shift">{needsMgr ? 'Manager sign-off & close shift' : 'Close shift'}</Button>
        {offline && <p className="text-center text-xs text-soft">Closing a shift needs a connection.</p>}
      </Card>
      <ManagerPinDialog open={pinOpen} onClose={() => setPinOpen(false)} reason="Cash variance is above the tolerance." onApproved={(pin) => close(pin)} />
    </div>
  );
}
