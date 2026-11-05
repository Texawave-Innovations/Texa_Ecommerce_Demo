'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gift, Search, UserPlus } from 'lucide-react';
import { Badge, Button, Dialog, Field, Input, toast } from '@texafashions/ui';
import type { PosCustomer } from '@texafashions/types';
import { data } from '@/lib/data';
import { useIsOffline, usePos } from '@/lib/store';

export function CustomerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = React.useState(''); const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState(''); const [wa, setWa] = React.useState(true); const [bday, setBday] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const offline = useIsOffline(); const setCustomer = usePos((s) => s.setCustomer);
  React.useEffect(() => { if (open) { setQ(''); setCreating(false); setName(''); setBday(''); } }, [open]);
  const kw = q.trim().toLowerCase();
  const res = useQuery({ queryKey: ['cust', kw], queryFn: () => data().pos.findCustomers(kw), enabled: open && kw.length >= 3 });
  const isMobile = /^[6-9]\d{9}$/.test(q.trim());
  const pick = (c: PosCustomer) => { setCustomer(c); onClose(); toast(`${c.name} added`, 'ok'); };
  const create = async () => {
    setBusy(true);
    try {
      const c = (await data().pos.command('createCustomer', { name: name.trim(), mobile: q.trim(), whatsappOptIn: wa, birthday: bday || null })) as unknown as PosCustomer;
      pick({ ...c, pointsBalance: c.pointsBalance ?? 0 });
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Customer">
      <div className="space-y-3">
        <label className="flex h-12 items-center gap-2 rounded-pill border border-line bg-card px-4"><Search className="size-4 text-soft" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value.replace(/[^\w\s]/g, ''))} data-testid="cust-search" inputMode="tel" placeholder="Mobile number or name" className="h-full flex-1 bg-transparent outline-none" /></label>
        {offline && <p className="rounded-2xl bg-butter/50 p-2.5 text-xs">Offline — searching customers cached on this tablet.</p>}
        <div className="max-h-64 space-y-2 overflow-auto">
          {res.data?.map((c) => (
            <button key={c.id} onClick={() => pick(c)} data-testid={`cust-${c.code}`} className="flex w-full items-center justify-between rounded-2xl border border-line bg-card p-3 text-left active:scale-[.99]">
              <span><span className="block font-medium">{c.name}</span><span className="text-xs text-soft">{c.mobile}</span></span>
              <span className="flex items-center gap-2"><Badge tone={c.tierId === 'SEOULMATE' ? 'lavender' : c.tierId === 'BESTIE' ? 'blush' : 'butter'}>{c.tierId ?? 'CUTIE'}</Badge><span className="flex items-center gap-1 text-xs text-soft"><Gift className="size-3" />{c.pointsBalance} pts</span></span>
            </button>
          ))}
        </div>
        {kw.length >= 3 && !res.isFetching && !res.data?.length && isMobile && !creating && (
          <Button variant="soft" className="w-full" onClick={() => setCreating(true)} disabled={offline} data-testid="cust-new"><UserPlus className="size-4" />{offline ? 'Reconnect to create a customer' : `Create customer for ${q}`}</Button>
        )}
        {creating && (
          <div className="space-y-3 rounded-3xl bg-card2 p-4">
            <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="cust-name" autoFocus /></Field>
            <Field label="Birthday (optional, for birthday bonus)"><Input type="date" value={bday} onChange={(e) => setBday(e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={wa} onChange={(e) => setWa(e.target.checked)} className="size-4 accent-[var(--cherry)]" />Send e-bills on WhatsApp</label>
            <Button onClick={create} loading={busy} disabled={name.trim().length < 2} className="w-full" data-testid="cust-save">Save &amp; add to bill</Button>
          </div>
        )}
        <button onClick={onClose} className="w-full rounded-pill py-2 text-sm text-soft">Continue without customer</button>
      </div>
    </Dialog>
  );
}
