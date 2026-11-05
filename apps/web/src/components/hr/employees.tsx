'use client';
import * as React from 'react';
import Fuse from 'fuse.js';
import { leaveBalance } from '@texafashions/domain';
import { Badge, Button, Card, EmptyState, Field, Input, Skeleton, Tabs } from '@texafashions/ui';
import { DataTable, PageHead, useCommand, useDoc, useMaster, useRows, useScope } from '../scm/kit';
import { HrNav, dateStr, dt } from './shared';

export function EmployeesList() {
  const scope = useScope();
  const { rows: employees, loading } = useMaster('employees');
  const { map: desigs } = useMaster('designations');
  const { map: stores } = useMaster('stores');
  const [q, setQ] = React.useState('');
  const visible = React.useMemo(() => employees.filter((e) => scope.all || scope.storeIds.includes(String(e.storeId))), [employees, scope.all, scope.storeIds]);
  const fuse = React.useMemo(() => new Fuse(visible, { keys: ['name', 'code', 'mobile'], threshold: 0.3 }), [visible]);
  const shown = q.trim() ? fuse.search(q.trim()).map((h) => h.item) : visible;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHead title="Employees" sub={`${visible.length} active employee(s) in scope.`} />
      <HrNav current="/hr/employees" />
      <Field label="Search"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, code or mobile…" aria-label="Search employees" /></Field>
      {loading ? <Card className="p-4"><Skeleton className="h-40" /></Card> : (
        <DataTable rows={shown as never} empty={<EmptyState kind="bunny" title="No employees found" />} cols={[
          { key: 'name', header: 'Employee', cell: (r) => <a href={`/hr/employees/${r.id}`} className="font-medium hover:text-cherry">{r.name}<span className="block text-xs text-soft">{r.id}</span></a> },
          { key: 'designation', header: 'Designation', cell: (r) => String(desigs.get(String(r.designationId))?.name ?? r.designationId ?? '—') },
          { key: 'store', header: 'Store', cell: (r) => String(stores.get(String(r.storeId))?.name ?? r.storeId ?? 'Head office') },
          { key: 'mobile', header: 'Mobile', cell: (r) => String(r.mobile ?? '—') },
          { key: 'doj', header: 'Joined', cell: (r) => dateStr(r.doj as string) },
        ]} />
      )}
    </div>
  );
}

export function EmployeeDetail({ id }: { id: string }) {
  const { map: employees, loading } = useMaster('employees');
  const { map: desigs } = useMaster('designations');
  const { map: stores } = useMaster('stores');
  const { map: depts } = useMaster('hrDepartments');
  const [tab, setTab] = React.useState<'profile' | 'attendance' | 'leave' | 'onboarding'>('profile');
  const emp = employees.get(id);
  if (loading) return <Card className="p-4"><Skeleton className="h-40" /></Card>;
  if (!emp) return <EmptyState kind="capybara" title="Employee not found" />;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHead title={String(emp.name)} sub={`${id} · ${String(desigs.get(String(emp.designationId))?.name ?? emp.designationId)}`} back={{ href: '/hr/employees', label: 'Employees' }} />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'profile', label: 'Profile' }, { value: 'attendance', label: 'Attendance' }, { value: 'leave', label: 'Leave' }, { value: 'onboarding', label: 'Onboarding' }]} />
      {tab === 'profile' && (
        <Card className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          {[
            ['Store', String(stores.get(String(emp.storeId))?.name ?? emp.storeId ?? 'Head office')],
            ['Department', String(depts.get(String(emp.hrDepartmentId))?.name ?? '—')],
            ['Designation', String(desigs.get(String(emp.designationId))?.name ?? '—')],
            ['Mobile', String(emp.mobile ?? '—')], ['Email', String(emp.email ?? '—')],
            ['Date of joining', dateStr(emp.doj as string)], ['Work state', String(emp.state ?? '—')],
          ].map(([l, v]) => <div key={l}><dt className="text-xs text-soft">{l}</dt><dd className="font-medium">{v}</dd></div>)}
          <a href={`/master/employees/${id}`} className="text-sm text-cherry underline sm:col-span-2">Edit master record →</a>
        </Card>
      )}
      {tab === 'attendance' && <EmployeeAttendance id={id} />}
      {tab === 'leave' && <EmployeeLeave id={id} />}
      {tab === 'onboarding' && <EmployeeOnboarding id={id} />}
    </div>
  );
}

function EmployeeAttendance({ id }: { id: string }) {
  const rows = useRows('attendance', { where: [['employeeId', '==', id]], orderBy: ['date', 'desc'], limit: 31 });
  const TONE = { present: 'mint', late: 'butter', absent: 'cherry' } as const;
  return (
    <DataTable rows={rows} empty={<EmptyState kind="bear" title="No attendance recorded yet" />} cols={[
      { key: 'date', header: 'Date', cell: (r) => dateStr(r.date as string) },
      { key: 'status', header: 'Status', cell: (r) => <Badge tone={TONE[r.status as keyof typeof TONE] ?? 'lavender'}>{String(r.status)}</Badge> },
      { key: 'in', header: 'Check-in', cell: (r) => dt(r.checkInAt as string) },
      { key: 'out', header: 'Check-out', cell: (r) => dt(r.checkOutAt as string) },
      { key: 'geo', header: 'Geofence', cell: (r) => (r.distanceM != null ? `${r.distanceM}m` : '—') },
    ]} />
  );
}

function EmployeeLeave({ id }: { id: string }) {
  const rows = useRows('leaveRequests', { where: [['employeeId', '==', id]], orderBy: ['fromDate', 'desc'] });
  const { rows: types } = useMaster('leaveTypes');
  const year = new Date().getFullYear();
  const TONE = { approved: 'mint', pending: 'butter', rejected: 'cherry' } as const;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {types.map((t) => {
          const mine = (rows ?? []).filter((r) => r.leaveTypeId === t.id && String(r.fromDate).slice(0, 4) === String(year));
          const approved = mine.filter((r) => r.status === 'approved').reduce((a, r) => a + Number(r.days), 0);
          const pending = mine.filter((r) => r.status === 'pending').reduce((a, r) => a + Number(r.days), 0);
          const bal = leaveBalance(Number(t.annualQuota ?? 0), approved, pending);
          return <Card key={t.id} className="p-3 text-center"><p className="text-xs text-soft">{String(t.name)}</p><p className="font-display text-2xl">{Number.isFinite(bal.available) ? bal.available : '∞'}</p><p className="text-xs text-soft">of {t.annualQuota as number}</p></Card>;
        })}
      </div>
      <DataTable rows={rows} empty={<EmptyState kind="bunny" title="No leave requests" />} cols={[
        { key: 'type', header: 'Type', cell: (r) => String(types.find((t) => t.id === r.leaveTypeId)?.name ?? r.leaveTypeId) },
        { key: 'dates', header: 'Dates', cell: (r) => `${dateStr(r.fromDate as string)} – ${dateStr(r.toDate as string)}` },
        { key: 'days', header: 'Days', align: 'right', cell: (r) => String(r.days) },
        { key: 'status', header: 'Status', cell: (r) => <Badge tone={TONE[r.status as keyof typeof TONE] ?? 'lavender'}>{String(r.status)}</Badge> },
      ]} />
    </div>
  );
}

function EmployeeOnboarding({ id }: { id: string }) {
  const doc = useDoc('onboardingTasks', id);
  const { run, busy } = useCommand();
  if (doc === undefined) return <Card className="p-4"><Skeleton className="h-24" /></Card>;
  if (!doc) return <EmptyState kind="capybara" title="No onboarding checklist" hint="Only created when this employee was hired through the Recruitment kanban." />;
  const items = doc.items as { key: string; label: string; done: boolean }[];
  return (
    <Card className="p-4">
      <ul className="flex flex-col gap-2">
        {items.map((t) => (
          <li key={t.key} className="flex items-center justify-between gap-3 border-b border-line/60 py-2 last:border-0">
            <span className={t.done ? 'text-soft line-through' : ''}>{t.label}</span>
            <Button size="sm" variant={t.done ? 'soft' : 'primary'} loading={busy} onClick={() => run('toggleOnboardingTask', { employeeId: id, taskKey: t.key, done: !t.done }, t.done ? 'Marked pending' : 'Marked done')}>{t.done ? 'Undo' : 'Mark done'}</Button>
          </li>
        ))}
      </ul>
      {doc.completedAt && <p className="mt-3 text-sm text-mint-700">✓ Onboarding complete</p>}
    </Card>
  );
}
