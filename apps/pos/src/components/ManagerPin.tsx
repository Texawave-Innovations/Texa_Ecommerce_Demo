'use client';
import * as React from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button, Dialog, toast } from '@texafashions/ui';
import { data } from '@/lib/data';
import { usePos } from '@/lib/store';
import { PinPad } from './PinPad';

/** Manager PIN gate for overrides, voids, big refunds. The PIN is re-verified server-side by the function that performs the action. */
export function ManagerPinDialog({ open, onClose, reason, onApproved }: { open: boolean; onClose: () => void; reason: string; onApproved: (pin: string, manager: { managerId: string; managerName: string }) => void }) {
  const [pin, setPin] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const storeId = usePos((s) => s.storeId);
  React.useEffect(() => { if (open) { setPin(''); setErr(''); } }, [open]);
  const go = async () => {
    if (pin.length < 4 || !storeId) return; setBusy(true); setErr('');
    try {
      const r = (await data().pos.command('verifyManagerPin', { storeId, pin })) as { ok: boolean; managerId: string; managerName: string };
      if (!r.ok) throw new Error('Not a manager PIN');
      onApproved(pin, r); onClose(); toast(`Approved by ${r.managerName}`, 'ok');
    } catch (e) { setErr((e as Error).message.replace(/^.*(permission-denied|failed-precondition):?\s*/i, '')); setPin(''); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title={<span className="flex items-center gap-2"><ShieldCheck className="size-5 text-cherry" />Manager approval</span>}>
      <div className="flex flex-col items-center gap-3">
        <p className="text-center text-sm text-soft">{reason}</p>
        <PinPad value={pin} onChange={setPin} onSubmit={go} disabled={busy} />
        {err && <p className="text-sm font-medium text-cherry" role="alert">{err}</p>}
        <Button size="lg" onClick={go} loading={busy} disabled={pin.length < 4} data-testid="mgr-pin-ok">Approve</Button>
      </div>
    </Dialog>
  );
}
