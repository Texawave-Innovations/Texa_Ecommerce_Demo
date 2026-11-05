'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Select, Skeleton, toast } from '@texafashions/ui';
import { ROLES, ROLE_LABELS, type Role } from '@texafashions/types';
import { data } from '@/lib/data';
import { useSession } from '@/lib/stores';

export default function UsersPage() {
  const me = useSession((s) => s.session!);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['users'], queryFn: () => data().admin.listUsers() });
  const set = useMutation({
    mutationFn: (v: { uid: string; role: Role; storeIds: string[]; approvalLimitPaise: number }) => data().admin.setClaims(v.uid, { role: v.role, storeIds: v.storeIds, approvalLimitPaise: v.approvalLimitPaise }),
    onSuccess: () => { toast('Claims updated — the user gets them on next token refresh', 'ok'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => toast((e as Error).message, 'err'),
  });
  const canEdit = me.claims.role === 'super_admin';
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <header className="flex items-end justify-between"><div><h1 className="font-display text-3xl">Users & roles</h1><p className="text-sm text-soft">Custom claims drive both Security Rules and function permissions.</p></div>
        <Link href="/admin/audit" className="rounded-pill bg-blush/60 px-5 py-2 text-sm">Audit log →</Link></header>
      {q.isLoading ? <Skeleton className="h-60" /> : (
        <Card className="overflow-x-auto p-0"><table className="w-full text-sm">
          <thead className="bg-card2 text-left text-xs text-soft"><tr><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Stores</th><th className="p-3 text-right">Approval limit</th></tr></thead>
          <tbody>{q.data?.map((u) => (
            <tr key={u.uid} className="border-t border-line/60">
              <td className="p-3"><b className="font-medium">{u.displayName || u.uid}</b><br /><span className="text-xs text-soft">{u.email}</span></td>
              <td className="p-3">{canEdit && u.claims ? (
                <Select value={u.claims.role} aria-label={`Role for ${u.email}`} onChange={(e) => set.mutate({ uid: u.uid, role: e.target.value as Role, storeIds: u.claims!.storeIds, approvalLimitPaise: u.claims!.approvalLimitPaise })}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>) : <Badge>{u.claims ? ROLE_LABELS[u.claims.role] : 'none'}</Badge>}</td>
              <td className="p-3 text-xs">{u.claims?.storeIds.length ? u.claims.storeIds.join(', ') : 'All'}</td>
              <td className="num p-3">₹{((u.claims?.approvalLimitPaise ?? 0) / 100).toLocaleString('en-IN')}</td>
            </tr>))}</tbody></table>
          {!canEdit && <p className="p-3 text-xs text-soft">Read-only: only Super Admin can change claims.</p>}
        </Card>
      )}
      <Button variant="ghost" className="self-start" onClick={() => qc.invalidateQueries({ queryKey: ['users'] })}>Refresh</Button>
    </div>
  );
}
