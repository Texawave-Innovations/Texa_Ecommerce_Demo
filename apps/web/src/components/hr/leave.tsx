'use client';
import * as React from 'react';
import { inclusiveDays, leaveBalance } from '@texafashions/domain';
import { Badge, Button, Card, EmptyState, Field, Input, Select, Textarea } from '@texafashions/ui';
import { DataTable, PageHead, Tabbed, useCommand, useMaster, useRows, useScope } from '../scm/kit';
import { HR_APPROVER_ROLES, HrNav, dateStr } from './shared';

const TONE = { approved: 'mint', pending: 'butter', rejected: 'cherry' } as const;

export function LeaveView() {
  const { claims } = useScope();
  const [tab, setTab] = React.useState<'apply' | 'approve'>(HR_APPROVER_ROLES.includes(claims.role) ? 'approve' : 'apply');
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHead title="Leave" sub="Apply for leave against your balance, or approve pending requests." />
      <HrNav current="/hr/leave" />
      <Tabbed value={tab} onChange={setTab} tabs={[{ value: 'apply', label: 'Apply' }, { value: 'approve', label: 'Approve' }]} />
      {tab === 'apply' ? <ApplyLeave /> : <ApproveLeave />}
    </div>
  );
}

export function ApplyLeave() {
  const { rows: employees } = useMaster('employees');
  const { rows: types } = useMaster('leaveTypes');
  const { run, busy } = useCommand();
  const [employeeId, setEmployeeId] = React.useState('');
  const [leaveTypeId, setLeaveTypeId] = React.useState('');
  const [from, setFrom] = React.useState(''); const [to, setTo] = React.useState(''); const [reason, setReason] = React.useState('');
  React.useEffect(() => { if (!employeeId && employees[0]) setEmployeeId(employees[0].id); }, [employees, employeeId]);
  React.useEffect(() => { if (!leaveTypeId && types[0]) setLeaveTypeId(types[0].id); }, [types, leaveTypeId]);
  const mine = useRows('leaveRequests', { where: employeeId ? [['employeeId', '==', employeeId]] : undefined }, !!employeeId);
  const type = types.find((t) => t.id === leaveTypeId);
  const year = new Date().getFullYear();
  const bal = React.useMemo(() => {
    if (!type) return null;
    const inYear = (mine ?? []).filter((r) => r.leaveTypeId === leaveTypeId && String(r.fromDate).slice(0, 4) === String(year));
    const approved = inYear.filter((r) => r.status === 'approved').reduce((a, r) => a + Number(r.days), 0);
    const pending = inYear.filter((r) => r.status === 'pending').reduce((a, r) => a + Number(r.days), 0);
    return leaveBalance(Number(type.annualQuota ?? 0), approved, pending);
  }, [mine, type, leaveTypeId, year]);
  const days = from && to ? inclusiveDays(from, to) : 0;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <form className="flex flex-col gap-3" onSubmit={async (e) => {
        e.preventDefault();
        const r = await run('applyLeave', { employeeId, leaveTypeId, fromDate: from, toDate: to, reason: reason || null }, (x) => `Applied — ${x.balanceAfter} day(s) left`);
        if (r) { setFrom(''); setTo(''); setReason(''); }
      }}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Employee"><Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>{employees.map((e) => <option key={e.id} value={e.id}>{String(e.name)}</option>)}</Select></Field>
          <Field label="Leave type"><Select value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>{types.map((t) => <option key={t.id} value={t.id}>{String(t.name)}</option>)}</Select></Field>
          <Field label="From" required><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required /></Field>
          <Field label="To" required><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required /></Field>
        </div>
        <Field label="Reason"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
        {bal && <p className="text-sm text-soft">Balance: {Number.isFinite(bal.available) ? bal.available : 'unlimited'} day(s) available{days > 0 ? ` · requesting ${days}` : ''}</p>}
        <div className="flex justify-end"><Button type="submit" loading={busy} disabled={!from || !to}>Apply</Button></div>
      </form>
    </Card>
  );
}

function ApproveLeave() {
  const rows = useRows('leaveRequests', { orderBy: ['appliedAt', 'desc'] });
  const { rows: employees } = useMaster('employees');
  const { rows: types } = useMaster('leaveTypes');
  const { run, busy } = useCommand();
  const pending = (rows ?? []).filter((r) => r.status === 'pending');
  const decided = (rows ?? []).filter((r) => r.status !== 'pending');
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? id;
  const typeOf = (id: string) => types.find((t) => t.id === id)?.name ?? id;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="mb-2 font-display text-lg">Pending ({pending.length})</h3>
        {pending.length === 0 ? <EmptyState kind="capybara" title="All caught up" /> : (
          <div className="flex flex-col gap-2">
            {pending.map((r) => (
              <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div><p className="font-medium">{String(nameOf(r.employeeId))}</p><p className="text-xs text-soft">{String(typeOf(r.leaveTypeId))} · {dateStr(r.fromDate as string)} – {dateStr(r.toDate as string)} · {r.days} day(s)</p>{r.reason && <p className="text-xs text-soft">“{r.reason}”</p>}</div>
                <div className="flex gap-2"><Button size="sm" variant="soft" loading={busy} onClick={() => run('decideLeave', { leaveRequestId: r.id, approve: false }, 'Rejected')}>Reject</Button><Button size="sm" loading={busy} onClick={() => run('decideLeave', { leaveRequestId: r.id, approve: true }, 'Approved')}>Approve</Button></div>
              </Card>
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 className="mb-2 font-display text-lg">History</h3>
        <DataTable rows={decided} empty={<EmptyState kind="bunny" title="No decided requests yet" />} cols={[
          { key: 'emp', header: 'Employee', cell: (r) => String(nameOf(r.employeeId)) },
          { key: 'type', header: 'Type', cell: (r) => String(typeOf(r.leaveTypeId)) },
          { key: 'dates', header: 'Dates', cell: (r) => `${dateStr(r.fromDate as string)} – ${dateStr(r.toDate as string)}` },
          { key: 'status', header: 'Status', cell: (r) => <Badge tone={TONE[r.status as keyof typeof TONE] ?? 'lavender'}>{String(r.status)}</Badge> },
        ]} />
      </div>
    </div>
  );
}
