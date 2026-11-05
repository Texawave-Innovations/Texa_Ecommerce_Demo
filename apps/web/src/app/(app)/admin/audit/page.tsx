'use client';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, EmptyState, Skeleton } from '@texafashions/ui';
import { data } from '@/lib/data';

export default function AuditPage() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => data().admin.listAuditLogs({ limit: 150 }), refetchInterval: 6000 });
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <h1 className="font-display text-3xl">Audit log</h1>
      {q.isLoading ? <Skeleton className="h-60" /> : q.isError ? <Card><EmptyState kind="bear" title="Not allowed" hint="Only Super Admin, CFO and Auditor can read the audit log." /></Card> : !q.data?.length ? <Card><EmptyState title="Nothing logged yet" kind="bunny" /></Card> : (
        <Card className="overflow-x-auto p-0"><table className="w-full text-sm">
          <thead className="bg-card2 text-left text-xs text-soft"><tr><th className="p-3">When</th><th className="p-3">Who</th><th className="p-3">Action</th><th className="p-3">Entity</th></tr></thead>
          <tbody>{q.data.map((l) => (
            <tr key={l.id} className="border-t border-line/60 align-top"><td className="whitespace-nowrap p-3 text-xs text-soft">{l.at ? new Date(l.at).toLocaleString('en-IN') : ''}</td>
              <td className="p-3">{l.userName} <Badge tone="lavender">{l.role}</Badge></td><td className="p-3">{l.action}</td><td className="p-3 text-xs">{l.entity} · {l.entityId}</td></tr>))}</tbody></table></Card>
      )}
    </div>
  );
}
