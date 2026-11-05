'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Skeleton, Tabs, toast } from '@texafashions/ui';
import { canApproveMaster, MASTER_MAP, type Approval } from '@texafashions/types';
import { data } from '@/lib/data';
import { useSession } from '@/lib/stores';
import { displayCell } from '@/lib/masterConvert';

export default function ApprovalsPage() {
  const s = useSession((x) => x.session!);
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<'pending' | 'all'>('pending');
  const q = useQuery({ queryKey: ['approvals', tab], queryFn: () => data().masters.listApprovals(tab === 'pending' ? 'pending' : undefined), refetchInterval: 5000 });
  const decide = useMutation({
    mutationFn: (v: { id: string; approve: boolean }) => data().masters.decide(v.id, v.approve),
    onSuccess: (_d, v) => { toast(v.approve ? 'Approved and applied' : 'Rejected', 'ok'); qc.invalidateQueries({ queryKey: ['approvals'] }); qc.invalidateQueries({ queryKey: ['pending-count'] }); },
    onError: (e) => toast((e as Error).message, 'err'),
  });
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-3xl">Approvals</h1><p className="text-sm text-soft">Maker-checker: you cannot approve your own change.</p></div>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'pending', label: 'Pending' }, { value: 'all', label: 'All' }]} />
      </header>
      {q.isLoading ? <Skeleton className="h-40" /> : !q.data?.length ? <Card><EmptyState kind="bunny" title="All caught up" hint="No approvals waiting." /></Card> : (
        <ul className="flex flex-col gap-3">{q.data.map((a) => <ApprovalCard key={a.id} a={a} uid={s.uid} role={s.claims.role} onDecide={(approve) => decide.mutate({ id: a.id, approve })} busy={decide.isPending} />)}</ul>
      )}
    </div>
  );
}

function ApprovalCard({ a, uid, role, onDecide, busy }: { a: Approval; uid: string; role: Parameters<typeof canApproveMaster>[0]; onDecide: (approve: boolean) => void; busy: boolean }) {
  const def = MASTER_MAP[a.master];
  const own = a.requestedBy === uid;
  const can = a.status === 'pending' && !own && !!def && canApproveMaster(role, a.master);
  const changed = a.kind === 'bulk' || !def ? [] : def.fields.filter((f) => JSON.stringify(a.before?.[f.key]) !== JSON.stringify(a.after?.[f.key]));
  return (
    <li><Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Badge tone={a.status === 'pending' ? 'butter' : a.status === 'approved' ? 'mint' : 'blush'}>{a.status}</Badge><b>{def?.label ?? a.master}</b><span className="text-soft">· {a.kind}{a.docId ? ` · ${a.docId}` : ''}</span></div>
        <span className="text-xs text-soft">{a.requestedByName} · {a.requestedAt ? new Date(a.requestedAt).toLocaleString('en-IN') : ''}</span>
      </div>
      {a.kind === 'bulk' ? <p className="mt-3 text-sm">{a.rows?.length ?? 0} rows · {a.note}</p> : (
        <ul className="mt-3 space-y-1 text-sm">{changed.map((f) => (
          <li key={f.key} className="flex gap-2"><span className="w-36 shrink-0 text-soft">{f.label}</span>{a.before && <span className="text-cherry line-through">{displayCell(f, a.before[f.key])}</span>}<span>{displayCell(f, a.after?.[f.key])}</span></li>))}</ul>
      )}
      {a.status === 'pending' && (
        <div className="mt-4 flex items-center justify-end gap-2">
          {own && <span className="mr-auto text-xs text-soft">Your own request — switch role to approve.</span>}
          {!own && !can && <span className="mr-auto text-xs text-soft">Your role can&apos;t approve this master.</span>}
          <Button variant="ghost" size="sm" disabled={!can || busy} onClick={() => onDecide(false)}>Reject</Button>
          <Button size="sm" disabled={!can || busy} onClick={() => onDecide(true)}>Approve</Button>
        </div>
      )}
    </Card></li>
  );
}
