'use client';
import * as React from 'react';
import { Badge, Card, EmptyState, Field, Select } from '@texafashions/ui';
import { DataTable, inr, PageHead, Tabbed, useDoc, useMaster, useRows, useScope } from '../scm/kit';
import { ApplyLeave } from './leave';
import { PayslipDialog } from './payroll';
import { HrNav, mondayOf, ymd } from './shared';

type Doc = Record<string, any>;

export function EssView() {
  const scope = useScope();
  const { rows: employees } = useMaster('employees');
  const { rows: shiftMaster } = useMaster('hrShifts');
  const mine = scope.all ? employees : employees.filter((e) => scope.storeIds.includes(String(e.storeId)));
  const [employeeId, setEmployeeId] = React.useState('');
  React.useEffect(() => { if (mine.length && !mine.some((e) => e.id === employeeId)) setEmployeeId(mine[0]!.id); }, [mine, employeeId]);
  const emp = employees.find((e) => e.id === employeeId);
  const [tab, setTab] = React.useState<'payslips' | 'leave' | 'roster'>('payslips');

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHead title="My workspace" sub="Pick yourself to see your payslips, apply for leave, and check your roster." />
      <HrNav current="/hr/me" />
      <Field label="I am…"><Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} aria-label="Employee">{mine.map((e) => <option key={e.id} value={e.id}>{String(e.name)}</option>)}</Select></Field>
      <Tabbed value={tab} onChange={setTab} tabs={[{ value: 'payslips', label: 'My payslips' }, { value: 'leave', label: 'My leave' }, { value: 'roster', label: 'My roster' }]} />
      {tab === 'payslips' && <MyPayslips employeeId={employeeId} />}
      {tab === 'leave' && <ApplyLeave />}
      {tab === 'roster' && <MyRoster employeeId={employeeId} storeId={String(emp?.storeId ?? '')} shiftMaster={shiftMaster} />}
    </div>
  );
}

function MyPayslips({ employeeId }: { employeeId: string }) {
  const rows = useRows('payslips', { where: employeeId ? [['employeeId', '==', employeeId]] : undefined }, !!employeeId);
  const [open, setOpen] = React.useState<Doc | null>(null);
  const sorted = rows ? rows.slice().sort((a, b) => String(b.month).localeCompare(String(a.month))) : null;
  return (
    <>
      <DataTable rows={sorted} empty={<EmptyState kind="bunny" title="No payslips yet" />} cols={[
        { key: 'month', header: 'Month', cell: (r) => <button className="font-medium text-cherry hover:underline" onClick={() => setOpen(r)}>{String(r.month)}</button> },
        { key: 'grossPaise', header: 'Gross', align: 'right', cell: (r) => inr(Number(r.grossPaise)) },
        { key: 'netPaise', header: 'Net pay', align: 'right', cell: (r) => inr(Number(r.netPaise)) },
      ]} />
      <PayslipDialog payslip={open} onClose={() => setOpen(null)} />
    </>
  );
}

function MyRoster({ employeeId, storeId, shiftMaster }: { employeeId: string; storeId: string; shiftMaster: Doc[] }) {
  const weekStart = ymd(mondayOf(new Date()));
  const roster = useDoc('rosters', storeId ? `${storeId}_${weekStart}` : null);
  if (!storeId) return <EmptyState kind="capybara" title="Not assigned to a store" />;
  if (!roster) return <EmptyState kind="bear" title="No roster published for this week yet" />;
  const days = (roster.days ?? []) as { date: string; shifts: { shiftId: string; employeeIds: string[] }[] }[];
  const mine = days.map((d) => ({ date: d.date, shift: d.shifts.find((s) => s.employeeIds.includes(employeeId)) }));
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h3 className="font-display text-lg">Week of {weekStart}</h3>
      <dl className="grid grid-cols-2 gap-y-3 text-sm sm:grid-cols-4">
        {mine.map((d) => {
          const shiftDef = d.shift ? shiftMaster.find((s) => s.id === d.shift!.shiftId) : null;
          return (
            <div key={d.date}>
              <dt className="text-xs text-soft">{d.date}</dt>
              <dd className="mt-1">{shiftDef ? <Badge tone="mint">{String(shiftDef.name)} · {String(shiftDef.start)}–{String(shiftDef.end)}</Badge> : <Badge tone="lavender">Off</Badge>}</dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}
