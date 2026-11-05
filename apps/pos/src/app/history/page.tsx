'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Ban, CloudOff, Printer, Undo2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Select, SlideOver, toast } from '@texafashions/ui';
import type { PosOutboxRow, SaleDoc } from '@texafashions/types';
import { isProvisionalNo } from '@texafashions/domain';
import { Page, useOutbox } from '@/components/Shell';
import { ManagerPinDialog } from '@/components/ManagerPin';
import { Receipt } from '@/components/Receipt';
import { data } from '@/lib/data';
import { useIsOffline, usePos } from '@/lib/store';
import { fmtDateTime, inr } from '@/lib/stores';

export default function HistoryPage() { return <Page><History /></Page>; }

function History() {
  const router = useRouter(); const { shiftId, storeId, tillId } = usePos(); const offline = useIsOffline();
  const [sales, setSales] = React.useState<SaleDoc[]>([]); const outbox = useOutbox();
  const [sel, setSel] = React.useState<SaleDoc | null>(null); const [pinOpen, setPinOpen] = React.useState(false); const [voidReason, setVoidReason] = React.useState('RC-VOID-ERR');
  React.useEffect(() => { if (!shiftId || !storeId) return; return data().pos.subscribeSales(storeId, shiftId, setSales); }, [shiftId, storeId]);
  const waiting = outbox.filter((o) => o.status !== 'finalised' || !sales.some((s) => s.id === o.clientSaleId));
  const pendingOnly = waiting.filter((o) => o.status !== 'finalised');
  const doVoid = async (pin: string) => {
    if (!sel || !storeId || !tillId || !shiftId) return;
    try { await data().pos.command('voidSale', { saleId: sel.id, storeId, tillId, shiftId, reasonCode: voidReason, managerPin: pin }); toast('Bill voided', 'ok'); setSel(null); }
    catch (e) { toast((e as Error).message.replace(/^.*(failed-precondition|permission-denied):?\s*/i, ''), 'err'); }
  };
  return (
    <div className="mx-auto h-full max-w-4xl space-y-5 overflow-auto p-5">
      <h2 className="font-display text-2xl">Bills this shift</h2>
      {pendingOnly.length > 0 && (
        <div className="space-y-2" data-testid="outbox-list"><div className="flex items-center gap-2 text-sm font-semibold"><CloudOff className="size-4" />Offline sales {offline ? 'waiting for connection' : 'syncing'}</div>
          {pendingOnly.map((o: PosOutboxRow) => <Card key={o.id} className="flex items-center justify-between !p-3 text-sm"><span><b>{o.provisionalNo}</b><span className="block text-xs text-soft">{fmtDateTime(o.createdAtClient)} · {o.status === 'failed' ? `failed: ${o.error}` : o.unsynced ? 'saved on this tablet' : 'uploaded, finalising…'}</span></span><span className="flex items-center gap-2"><Badge tone={o.status === 'failed' ? 'blush' : 'butter'}>{o.status}</Badge><b>{inr(o.clientTotalPaise)}</b></span></Card>)}
        </div>
      )}
      {!sales.length && !pendingOnly.length && <EmptyState title="No bills yet" hint="Completed sales for this shift appear here." />}
      <div className="space-y-2">
        {sales.map((s) => (
          <button key={s.id} onClick={() => setSel(s)} className="flex w-full items-center justify-between rounded-3xl border border-line/60 bg-card p-4 text-left shadow-soft active:scale-[.99]" data-testid="bill-row">
            <span><b>{s.invoiceNo}</b>{s.source === 'offline' && <Badge tone="lavender" className="ml-2">offline</Badge>}{s.needsReview && <Badge tone="butter" className="ml-1">review</Badge>}<span className="block text-xs text-soft">{fmtDateTime(s.createdAt)} · {s.customer?.name ?? 'Walk-in'} · {s.lines.reduce((a, l) => a + l.qty, 0)} items · {s.payments.map((p) => p.mode).join('+')}</span></span>
            <span className="flex items-center gap-2">{s.status !== 'completed' && <Badge tone="butter">{s.status.replace('_', ' ')}</Badge>}<b className="font-display text-xl">{inr(s.payablePaise)}</b></span>
          </button>
        ))}
      </div>
      <SlideOver open={!!sel} onClose={() => setSel(null)} title={sel?.invoiceNo ?? ''} width={420}>
        {sel && (
          <div className="space-y-4">
            <div className="flex justify-center"><Receipt sale={sel} /></div>
            <div className="flex gap-2 print:hidden"><Button variant="outline" className="flex-1" onClick={() => window.print()}><Printer className="size-4" />Reprint</Button><Button variant="soft" className="flex-1" disabled={sel.status === 'voided' || isProvisionalNo(sel.invoiceNo)} onClick={() => router.push(`/returns?sale=${sel.id}`)}><Undo2 className="size-4" />Return</Button></div>
            {sel.status === 'completed' && !isProvisionalNo(sel.invoiceNo) && (
              <div className="space-y-2 rounded-3xl bg-card2 p-3 print:hidden"><div className="text-xs font-semibold uppercase text-soft">Void this bill (same shift, manager PIN)</div>
                <Select value={voidReason} onChange={(e) => setVoidReason(e.target.value)}><option value="RC-VOID-ERR">Cashier error</option></Select>
                <Button variant="danger" className="w-full" onClick={() => setPinOpen(true)} disabled={offline} data-testid="void-btn"><Ban className="size-4" />Void bill</Button></div>
            )}
          </div>
        )}
      </SlideOver>
      <ManagerPinDialog open={pinOpen} onClose={() => setPinOpen(false)} reason="Voiding a bill reverses stock, payments and points." onApproved={(pin) => doVoid(pin)} />
    </div>
  );
}
