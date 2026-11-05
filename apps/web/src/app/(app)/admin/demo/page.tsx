'use client';
import * as React from 'react';
import { Activity, BellRing, RotateCcw, ShoppingBag, WifiOff } from 'lucide-react';
import { Badge, Button, Card, StaggerGrid, toast } from '@texafashions/ui';
import type { DemoControlInput } from '@texafashions/types';
import { data } from '@/lib/data';
import { useSession } from '@/lib/stores';
import { PageHead } from '@/components/scm/kit';

const POS_URL = process.env.NEXT_PUBLIC_POS_URL ?? 'http://localhost:3101';

interface Control { key: string; icon: React.ReactNode; title: string; body: string; cta: string; run: () => Promise<string> }

export default function DemoControls() {
  const role = useSession((s) => s.session?.claims.role);
  const [busy, setBusy] = React.useState<string | null>(null);

  const fn = (action: DemoControlInput['action']) => async () => (await data().admin.demoControl(action)).message;
  const controls: Control[] = [
    { key: 'busy_hour', icon: <Activity className="size-5" />, title: 'Simulate busy hour', body: 'Posts 10 real POS sales at Pune (till T1) and sends the Store Twin crowd to its 7 pm peak for 10 minutes. Open Store Twin to watch the ripples.', cta: 'Start busy hour', run: fn('busy_hour') },
    { key: 'web_orders', icon: <ShoppingBag className="size-5" />, title: 'Simulate 5 web orders', body: 'Feeds five Shopify-shaped orders through the same ingest path as the webhook: allocation, pick lists, sync health.', cta: 'Create 5 orders', run: fn('web_orders') },
    { key: 'critical_alert', icon: <BellRing className="size-5" />, title: 'Trigger a critical alert', body: 'Fans a critical cash-variance alert out to the CFO, store managers and you. Open the bell and tap “Ask why” to hand it to Uni.', cta: 'Trigger alert', run: fn('critical_alert') },
    {
      key: 'reset', icon: <RotateCcw className="size-5" />, title: 'Reset demo data', body: 'Re-runs the seed: clears operational documents and rebuilds masters and history. Takes about a minute. Run `pnpm seed` locally (the hosted site cannot run it).', cta: 'Reset to baseline',
      run: async () => { const r = await fetch('/api/demo/reset', { method: 'POST' }); const j = (await r.json()) as { message: string }; if (!r.ok) throw new Error(j.message); return j.message; },
    },
  ];

  async function go(c: Control) {
    if (c.key === 'reset' && !window.confirm('Reset all demo data to the seeded baseline?')) return;
    setBusy(c.key);
    try { toast(await c.run(), 'ok'); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  }

  if (role !== 'super_admin') return <Card className="mx-auto max-w-lg text-center"><p className="font-display text-xl">Super Admin only</p><p className="mt-1 text-sm text-soft">Switch role from the avatar menu to open the demo controls.</p></Card>;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHead title="Demo controls" sub="Drive the story live: every button runs the real handlers, nothing is faked client-side." actions={<Badge tone="lavender">Super Admin</Badge>} />
      <StaggerGrid className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {controls.map((c) => (
          <Card key={c.key} className="flex flex-col gap-3">
            <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-full bg-blush/60">{c.icon}</span><h2 className="font-display text-lg">{c.title}</h2></div>
            <p className="flex-1 text-sm text-soft">{c.body}</p>
            <Button className="self-start" disabled={busy !== null} onClick={() => go(c)}>{busy === c.key ? 'Working…' : c.cta}</Button>
          </Card>
        ))}
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-full bg-butter/70"><WifiOff className="size-5" /></span><h2 className="font-display text-lg">Toggle POS offline</h2></div>
          <p className="flex-1 text-sm text-soft">Opens the POS with the network forced off (sales queue in the outbox), or back on so the queue syncs. The same switch is the “Offline demo” pill in the POS top bar.</p>
          <div className="flex gap-2">
            <a href={`${POS_URL}/sell?offline=1`} target="texa-pos" className="rounded-pill bg-ink px-5 py-2 text-sm text-bg">Go offline</a>
            <a href={`${POS_URL}/sell?offline=0`} target="texa-pos" className="rounded-pill border border-line px-5 py-2 text-sm">Back online</a>
          </div>
        </Card>
      </StaggerGrid>
    </div>
  );
}
