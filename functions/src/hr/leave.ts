import type { z } from 'zod';
import type { ApplyLeaveInput, DecideLeaveInput } from '@texafashions/types';
import { inclusiveDays, leaveBalance } from '@texafashions/domain';
import { col, db, type Caller } from '../admin';
import { audit, fail, must, requireRoles, stamp } from '../engine';

export async function applyLeave(c: Caller, i: z.output<typeof ApplyLeaveInput>) {
  const days = inclusiveDays(i.fromDate, i.toDate);
  if (days < 1) fail('To date must be on or after from date');
  const lt = must((await col('leaveTypes').doc(i.leaveTypeId).get()).data() as Record<string, unknown> | undefined, 'Leave type not found');
  const year = i.fromDate.slice(0, 4);
  const existing = await col('leaveRequests').where('employeeId', '==', i.employeeId).where('leaveTypeId', '==', i.leaveTypeId).get();
  const inYear = existing.docs.map((d) => d.data()).filter((d) => String(d.fromDate).slice(0, 4) === year);
  const approvedDays = inYear.filter((d) => d.status === 'approved').reduce((a, d) => a + Number(d.days), 0);
  const pendingDays = inYear.filter((d) => d.status === 'pending').reduce((a, d) => a + Number(d.days), 0);
  const bal = leaveBalance(Number(lt.annualQuota ?? 0), approvedDays, pendingDays);
  if (days > bal.available) fail(`Only ${bal.available} day(s) of ${lt.name} left this year`);
  const ref = col('leaveRequests').doc();
  await ref.set({
    employeeId: i.employeeId, leaveTypeId: i.leaveTypeId, fromDate: i.fromDate, toDate: i.toDate, days, reason: i.reason ?? null,
    status: 'pending', appliedAt: stamp(), updatedAt: stamp(), decidedAt: null, decidedBy: null, note: null,
  });
  return { leaveRequestId: ref.id, days, balanceAfter: bal.available - days };
}

export async function decideLeave(c: Caller, i: z.output<typeof DecideLeaveInput>) {
  requireRoles(c, 'hr_manager', 'store_manager');
  const ref = col('leaveRequests').doc(i.leaveRequestId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const doc = must(snap.data() as Record<string, unknown> | undefined, 'Leave request not found');
    if (doc.status !== 'pending') fail(`Already ${doc.status}`);
    const status = i.approve ? 'approved' : 'rejected';
    tx.update(ref, { status, decidedAt: stamp(), decidedBy: c.uid, note: i.note ?? null, updatedAt: stamp() });
    audit(tx, c, { action: 'decide_leave', entity: 'leaveRequests', entityId: i.leaveRequestId, before: { status: 'pending' }, after: { status } });
    return { status };
  });
}
