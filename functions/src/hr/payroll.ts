/** Payroll run: gross (salary structure + attendance + overtime + POS commission) → PF/ESI/PT/TDS → net, one payslip per
 * employee, and a single org-wide GL journal (feeds tallyQueue via the existing `enqueueTallySync` trigger on `journals`). */
import type { z } from 'zod';
import { buildJournal, computePayroll, type StatutorySetting } from '@texafashions/domain';
import { WAREHOUSE_ID, type RunPayrollInput } from '@texafashions/types';
import { FieldValue, Timestamp, col, db, type Caller } from '../admin';
import { audit, fail, requireRoles, stamp } from '../engine';

type Doc = Record<string, any>;

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y!, m!, 0).getDate();
}
function parseHour(hhmm: unknown): number {
  const [h, m] = String(hhmm ?? '').split(':').map(Number);
  return (h || 0) + (m || 0) / 60;
}
function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v === 'string') return new Date(v);
  return null;
}

export async function runPayroll(c: Caller, i: z.output<typeof RunPayrollInput>) {
  requireRoles(c, 'hr_manager', 'cfo', 'super_admin');
  const runRef = col('payrollRuns').doc(i.month);
  const existing = await runRef.get();
  if (existing.exists && existing.get('status') === 'posted') fail(`Payroll for ${i.month} is already posted`);

  const days = daysInMonth(i.month);
  const monthStart = `${i.month}-01`;
  const monthEnd = `${i.month}-${String(days).padStart(2, '0')}`;
  const periodStart = Timestamp.fromDate(new Date(`${monthStart}T00:00:00.000Z`));
  const periodEnd = Timestamp.fromDate(new Date(`${monthEnd}T23:59:59.999Z`));

  const [empSnap, structSnap, statSnap, shiftSnap] = await Promise.all([
    col('employees').get(), col('salaryStructures').get(), col('statutorySettings').get(), col('hrShifts').get(),
  ]);
  const employees = empSnap.docs.filter((d) => d.get('status') !== 'inactive');
  if (!employees.length) fail('No active employees to run payroll for');
  const structures = new Map(structSnap.docs.map((d) => [d.id, d.data() as Doc]));
  const statutoryByState = new Map(statSnap.docs.map((d) => [d.get('state') as string, d.data() as Doc]));
  const anyStatutory = statSnap.docs[0]?.data() as Doc | undefined;
  const shiftsById = new Map(shiftSnap.docs.map((d) => [d.id, d.data() as Doc]));

  const payslips = await Promise.all(employees.map(async (empDoc) => {
    const emp = empDoc.data() as Doc;
    const structureDoc = structures.get(emp.salaryStructureId as string);
    const statutoryDoc = statutoryByState.get(emp.state as string) ?? anyStatutory;
    if (!structureDoc || !statutoryDoc) return null; // happy path: skip anyone with no salary structure / statutory setting assigned

    const [attSnap, salesSnap] = await Promise.all([
      col('attendance').where('employeeId', '==', empDoc.id).where('date', '>=', monthStart).where('date', '<=', monthEnd).get(),
      col('sales').where('cashierId', '==', empDoc.id).where('createdAt', '>=', periodStart).where('createdAt', '<=', periodEnd).get(),
    ]);
    const absentDays = attSnap.docs.filter((d) => d.get('status') === 'absent').length;
    const payableDays = Math.max(0, days - absentDays);

    const shift = shiftsById.get(emp.shiftId as string);
    const scheduledHours = shift ? Math.max(1, parseHour(shift.end) - parseHour(shift.start)) : 8;
    const overtimeHours = attSnap.docs.reduce((sum, d) => {
      const a = d.data() as Doc;
      const inAt = toDate(a.checkInAt); const outAt = toDate(a.checkOutAt);
      if (!inAt || !outAt) return sum;
      return sum + Math.max(0, (outAt.getTime() - inAt.getTime()) / 3_600_000 - scheduledHours);
    }, 0);

    const salesNetPaise = salesSnap.docs.reduce((sum, d) => sum + Number(d.get('netPaise') ?? 0), 0);

    const structure = {
      basicPaise: Number(structureDoc.basicPaise ?? 0), hraPaise: Number(structureDoc.hraPaise ?? 0), specialAllowancePaise: Number(structureDoc.specialAllowancePaise ?? 0),
      commissionPct: Number(structureDoc.commissionPct ?? 0), pfApplicable: !!structureDoc.pfApplicable, esiApplicable: !!structureDoc.esiApplicable,
    };
    const statutory: StatutorySetting = {
      pfEmployeePct: Number(statutoryDoc.pfEmployeePct ?? 0), pfEmployerPct: Number(statutoryDoc.pfEmployerPct ?? 0),
      esiEmployeePct: Number(statutoryDoc.esiEmployeePct ?? 0), esiEmployerPct: Number(statutoryDoc.esiEmployerPct ?? 0),
      ptSlabs: (statutoryDoc.ptSlabs as { upTo: number | null; tax: number }[]) ?? [],
    };
    const result = computePayroll({ structure, statutory, daysInMonth: days, payableDays, overtimeHours, salesNetPaise });
    return { employeeId: empDoc.id, employeeName: String(emp.name ?? empDoc.id), storeId: (emp.storeId as string | undefined) ?? null, payableDays, overtimeHours: Math.round(overtimeHours * 100) / 100, salesNetPaise, ...result };
  }));

  const rows = payslips.filter((p): p is NonNullable<typeof p> => !!p);
  if (!rows.length) fail('No employee had a salary structure and statutory setting assigned — nothing to run');

  const totals = rows.reduce((a, r) => ({
    grossPaise: a.grossPaise + r.grossPaise, pfEmployeePaise: a.pfEmployeePaise + r.pfEmployeePaise, esiEmployeePaise: a.esiEmployeePaise + r.esiEmployeePaise,
    ptPaise: a.ptPaise + r.ptPaise, tdsPaise: a.tdsPaise + r.tdsPaise, netPaise: a.netPaise + r.netPaise,
  }), { grossPaise: 0, pfEmployeePaise: 0, esiEmployeePaise: 0, ptPaise: 0, tdsPaise: 0, netPaise: 0 });

  const journalLines = buildJournal({ kind: 'payroll', input: totals });
  const jRef = col('journals').doc();
  const day = `${i.month}-01`;

  const batch = db.batch();
  rows.forEach((r) => {
    batch.set(col('payslips').doc(`${i.month}_${r.employeeId}`), {
      month: i.month, employeeId: r.employeeId, employeeName: r.employeeName, storeId: r.storeId,
      payableDays: r.payableDays, daysInMonth: days, overtimeHours: r.overtimeHours, salesNetPaise: r.salesNetPaise,
      basicPaise: r.basicPaise, hraPaise: r.hraPaise, specialAllowancePaise: r.specialAllowancePaise, overtimePaise: r.overtimePaise, commissionPaise: r.commissionPaise,
      grossPaise: r.grossPaise, pfEmployeePaise: r.pfEmployeePaise, pfEmployerPaise: r.pfEmployerPaise, esiEmployeePaise: r.esiEmployeePaise, esiEmployerPaise: r.esiEmployerPaise,
      ptPaise: r.ptPaise, tdsPaise: r.tdsPaise, totalDeductionsPaise: r.totalDeductionsPaise, netPaise: r.netPaise,
      runId: i.month, status: 'posted', createdAt: stamp(), updatedAt: stamp(),
    });
  });
  batch.set(runRef, {
    month: i.month, status: 'posted', employeeCount: rows.length, daysInMonth: days,
    ...totals, journalId: jRef.id, runBy: c.uid, runByName: c.name, runAt: stamp(), updatedAt: stamp(),
  }, { merge: true });
  batch.set(jRef, { event: 'payroll', refType: 'payrollRun', refId: i.month, storeId: WAREHOUSE_ID, day, lines: journalLines, balanced: true, at: FieldValue.serverTimestamp() });
  audit(batch, c, { action: 'run_payroll', entity: 'payrollRun', entityId: i.month, before: null, after: { employeeCount: rows.length, netPaise: totals.netPaise } });
  await batch.commit();

  return { month: i.month, employeeCount: rows.length, ...totals };
}
