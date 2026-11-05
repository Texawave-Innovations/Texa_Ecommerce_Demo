'use client';
import * as React from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Bell, Check, MessageCircleQuestion, Play, RotateCcw, UserPlus } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Skeleton, SlideOver, Tabs, cn, toast } from '@texafashions/ui';
import { DEMO_USERS, type Briefing, type InboxItem, type InboxSeverity } from '@texafashions/types';
import { data } from '@/lib/data';
import { useSession } from '@/lib/stores';

const TONE = { critical: 'cherry', warning: 'butter', info: 'sky' } as const;
const isSnoozed = (i: InboxItem) => i.status === 'snoozed' && !!i.snoozedUntil && new Date(i.snoozedUntil).getTime() > Date.now();
/** A snoozed row whose time has passed counts as new again. */
export const effective = (i: InboxItem): InboxItem['status'] => (i.status === 'snoozed' && !isSnoozed(i) ? 'new' : i.status);

/** Real-time inbox for the signed-in user; fires a wobble toast for each critical alert that arrives after the first load. */
export function useInbox() {
  const uid = useSession((s) => s.session?.uid);
  const [items, setItems] = React.useState<InboxItem[]>([]);
  const seen = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    seen.current = null; setItems([]);
    if (!uid) return;
    return data().ai.subscribeInbox((rows) => {
      if (seen.current) rows.filter((r) => r.severity === 'critical' && r.status === 'new' && !seen.current!.has(r.id)).forEach((r) => toast(`🚨 ${r.title}`, 'err'));
      seen.current = new Set(rows.map((r) => r.id)); setItems(rows);
    });
  }, [uid]);
  const unread = items.filter((i) => effective(i) === 'new').length;
  const criticalUnread = items.some((i) => effective(i) === 'new' && i.severity === 'critical');
  return { items, unread, criticalUnread };
}

export function BellButton({ unread, critical, onClick }: { unread: number; critical: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} className="relative grid size-10 place-items-center rounded-full hover:bg-card2">
      <Bell className="size-5" />
      {unread > 0 && <span className={cn('absolute right-0.5 top-0.5 grid min-w-5 place-items-center rounded-full px-1 text-[10px] font-semibold', critical ? 'pulse-crit bg-cherry text-cherry-ink' : 'bg-lavender text-ink')}>{unread}</span>}
    </button>
  );
}

type Tab = InboxSeverity | 'done';
export function NotificationCentre({ open, onClose, items, onAskWhy }: { open: boolean; onClose: () => void; items: InboxItem[]; onAskWhy: (i: InboxItem) => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<Tab>('critical');
  const [busy, setBusy] = React.useState(false);
  const pending = useQuery({ queryKey: ['pending-count'], queryFn: () => new Promise<number>((res) => { const u = data().masters.subscribePendingCount((n) => { res(n); u(); }); }), enabled: open });
  const live = items.filter((i) => effective(i) !== 'resolved' && !isSnoozed(i));
  const count = (s: InboxSeverity) => live.filter((i) => i.severity === s).length;
  const shown = tab === 'done' ? items.filter((i) => i.status === 'resolved' || isSnoozed(i)) : live.filter((i) => i.severity === tab);

  async function runNow() {
    setBusy(true);
    try { const r = await data().ai.runAlertsNow(); toast(r.created ? `${r.created} new alert${r.created > 1 ? 's' : ''} found` : `Checked ${r.evaluated} signals — nothing new`, r.created ? 'ok' : 'info'); void qc.invalidateQueries({ queryKey: ['briefing'] }); }
    catch (e) { toast((e as Error).message, 'err'); }
    setBusy(false);
  }

  return (
    <SlideOver open={open} onClose={onClose} width={480} title={<span className="flex items-center gap-2"><Bell className="size-5 text-cherry" /> Notifications</span>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs<Tab> value={tab} onChange={setTab} items={[
            { value: 'critical', label: <>Critical <b>{count('critical')}</b></> }, { value: 'warning', label: <>Warning <b>{count('warning')}</b></> },
            { value: 'info', label: <>Info <b>{count('info')}</b></> }, { value: 'done', label: 'Done' },
          ]} />
          <Button size="sm" variant="soft" loading={busy} onClick={runNow}><Play className="size-4" /> Run now</Button>
        </div>
        {shown.length === 0
          ? <EmptyState kind="capybara" title={tab === 'done' ? 'Nothing snoozed or resolved' : 'All clear'} hint={tab === 'done' ? 'Resolved and snoozed items land here.' : 'No open items in this priority. Try “Run now”.'} />
          : <ul className="flex flex-col gap-3">{shown.map((i) => <Row key={i.id} item={i} onAskWhy={() => { onClose(); onAskWhy(i); }} />)}</ul>}
        <Link href="/master/approvals" onClick={onClose} className="text-sm text-cherry hover:underline">Approvals queue{pending.data ? ` (${pending.data} pending)` : ''} →</Link>
      </div>
    </SlideOver>
  );
}

function Row({ item: i, onAskWhy }: { item: InboxItem; onAskWhy: () => void }) {
  const me = useSession((s) => s.session!.uid);
  const [assign, setAssign] = React.useState(false);
  const act = async (action: 'read' | 'assign' | 'snooze' | 'resolve' | 'reopen', extra: { assignTo?: string; snoozeHours?: number } = {}) => {
    try { await data().ai.inboxAction({ id: i.id, action, ...extra }); if (action === 'resolve') toast('Marked resolved', 'ok'); if (action === 'snooze') toast('Snoozed for 4 hours'); if (action === 'assign') toast('Assigned', 'ok'); }
    catch (e) { toast((e as Error).message, 'err'); }
  };
  const status = effective(i);
  return (
    <li onMouseEnter={() => { if (status === 'new') void act('read'); }}>
      <Card className={cn('!p-4', status === 'new' && 'ring-1 ring-cherry/30', status === 'resolved' && 'opacity-60')}>
        <div className="flex items-start gap-2">
          <Badge tone={TONE[i.severity]}>{i.severity}</Badge>
          {i.storeId && <Badge tone="lavender">{i.storeId}</Badge>}
          {i.suggestion && <Badge tone="mint">suggestion</Badge>}
          {status === 'new' && <span className="ml-auto mt-1 size-2 rounded-full bg-cherry" aria-label="Unread" />}
        </div>
        <p className="mt-2 text-sm font-medium">{i.title}</p>
        <p className="mt-0.5 text-xs text-soft">{i.detail}</p>
        {i.assignedToName && <p className="mt-1 text-xs text-soft">Assigned to <b>{i.assignedTo === me ? 'you' : i.assignedToName}</b>{i.assignedBy ? ` by ${i.assignedBy}` : ''}</p>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button size="sm" variant="soft" onClick={onAskWhy}><MessageCircleQuestion className="size-4" /> Ask why</Button>
          {i.status === 'resolved' || isSnoozed(i)
            ? <Button size="sm" variant="ghost" onClick={() => void act('reopen')}><RotateCcw className="size-4" /> Reopen</Button>
            : <>
                <Button size="sm" variant="ghost" onClick={() => setAssign((a) => !a)} aria-expanded={assign}><UserPlus className="size-4" /> Assign</Button>
                <Button size="sm" variant="ghost" onClick={() => void act('snooze', { snoozeHours: 4 })}><AlarmClock className="size-4" /> Snooze</Button>
                <Button size="sm" variant="ghost" onClick={() => void act('resolve')}><Check className="size-4" /> Resolve</Button>
              </>}
          {i.link && <Link href={i.link} className="ml-auto self-center text-xs text-cherry hover:underline">Open →</Link>}
        </div>
        {assign && (
          <select aria-label="Assign to" defaultValue="" className="mt-2 h-9 w-full rounded-pill border border-line bg-card px-3 text-sm"
            onChange={(e) => { if (e.target.value) { void act('assign', { assignTo: e.target.value }); setAssign(false); } }}>
            <option value="" disabled>Pick a teammate…</option>
            {DEMO_USERS.filter((u) => u.role !== 'vendor' && u.uid !== me).map((u) => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}
          </select>
        )}
      </Card>
    </li>
  );
}

/** Home-dashboard card: one Claude call per day (cached server-side), rule-based text when no API key. */
export function BriefingCard() {
  const q = useQuery<Briefing>({ queryKey: ['briefing'], queryFn: () => data().ai.dailyBriefing(), staleTime: 5 * 60_000 });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl">Daily briefing</h2>
        {q.data && <Badge tone={q.data.source === 'claude' ? 'lavender' : 'butter'}>{q.data.source === 'claude' ? 'Written by Uni' : 'Rule-based'}</Badge>}
        {q.data?.cached && <Badge tone="mint">cached today</Badge>}
      </div>
      {q.isLoading ? <div className="mt-3 space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
        : q.isError ? <p className="mt-2 text-sm text-soft">Briefing unavailable for your role.</p>
        : (
          <>
            <p className="mt-2 whitespace-pre-line text-sm">{q.data!.text}</p>
            {q.data!.top.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {q.data!.top.map((t, i) => <li key={i} className="flex items-center gap-2 text-sm"><Badge tone={TONE[t.severity]}>{t.severity}</Badge><span className="min-w-0 truncate">{t.title}</span></li>)}
              </ul>
            )}
          </>
        )}
    </Card>
  );
}
