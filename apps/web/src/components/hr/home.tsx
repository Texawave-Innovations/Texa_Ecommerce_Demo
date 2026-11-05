'use client';
import * as React from 'react';
import { Card, Kpi } from '@texafashions/ui';
import { PageHead, useMaster, useRows, useScope } from '../scm/kit';
import { HrNav, todayStr } from './shared';

export function HrHome() {
  const scope = useScope();
  const { rows: employees } = useMaster('employees');
  const candidates = useRows('candidates', {});
  const leave = useRows('leaveRequests', { where: [['status', '==', 'pending']] });
  const attendance = useRows('attendance', { where: [['date', '==', todayStr()]] });

  const inScope = employees.filter((e) => scope.all || scope.storeIds.includes(String(e.storeId)));
  const present = (attendance ?? []).filter((a) => a.status !== 'absent' && inScope.some((e) => e.id === a.employeeId)).length;
  const openRoles = (candidates ?? []).filter((c) => !['hired', 'rejected'].includes(String(c.stage))).length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHead title="HR & Payroll" sub="Recruitment, onboarding, attendance, leave and the weekly roster." />
      <HrNav current="/hr" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Headcount" value={inScope.length} tone="sky" />
        <Kpi label="Present today" value={present} tone="mint" />
        <Kpi label="Open roles" value={openRoles} tone="butter" />
        <Kpi label="Pending leave" value={(leave ?? []).length} tone="blush" />
      </div>
      <Card className="p-5 text-sm text-soft">
        Run monthly payroll (PF/ESI/PT/TDS, payslips, bank transfer file and the Tally journal) under <a href="/hr/payroll" className="text-cherry hover:underline">Payroll</a>, or let an employee check their own payslips, leave and roster under <a href="/hr/me" className="text-cherry hover:underline">My workspace</a>.
      </Card>
    </div>
  );
}
