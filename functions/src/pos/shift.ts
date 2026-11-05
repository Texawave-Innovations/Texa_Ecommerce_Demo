import type { z } from 'zod';
import { CloseShiftInput, OpenShiftInput } from '@texafashions/types';
import { Z_VARIANCE_TOLERANCE_PAISE, countDenominations, zReport } from '@texafashions/domain';
import { FieldValue, Timestamp, col, db, type Caller } from '../admin';
import { audit, fail, must, requireLocation, requireRoles, reserveNumber } from '../engine';
import { isoOf } from './util';
import { requireManagerPin } from './pin';

type Doc = Record<string, any>;
const POS_ROLES = ['cashier', 'store_manager'] as const;

export async function openShift(c: Caller, input: z.output<typeof OpenShiftInput>) {
  requireRoles(c, ...POS_ROLES); requireLocation(c, input.storeId);
  const tillRef = col('tills').doc(input.tillId); const ref = col('shifts').doc();
  return db.runTransaction(async (tx) => {
    const till = must((await tx.get(tillRef)).data() as Doc | undefined, `Unknown till ${input.tillId}`);
    if (till.storeId !== input.storeId) fail('Till belongs to another store');
    if (till.openShiftId) fail(`Till already has an open shift (${till.openShiftId})`);
    const num = await reserveNumber(tx, 'SHF', input.storeId); num.write();
    tx.set(ref, { shiftNo: num.number, tillId: input.tillId, storeId: input.storeId, status: 'open', openingFloatPaise: input.openingFloatPaise, giftCardCashPaise: 0, openedBy: c.uid, openedByName: c.name, openedAt: FieldValue.serverTimestamp() });
    tx.update(tillRef, { openShiftId: ref.id, openShiftNo: num.number });
    audit(tx, c, { action: 'shift_open', entity: 'shifts', entityId: ref.id, before: null, after: { number: num.number, floatPaise: input.openingFloatPaise } });
    return { id: ref.id, shiftNo: num.number };
  });
}

export async function closeShift(c: Caller, input: z.output<typeof CloseShiftInput>) {
  requireRoles(c, ...POS_ROLES);
  const shiftRef = col('shifts').doc(input.shiftId);
  return db.runTransaction(async (tx) => {
    const shift = must((await tx.get(shiftRef)).data() as Doc | undefined, 'Shift not found');
    requireLocation(c, shift.storeId);
    if (shift.status !== 'open') fail('Shift is already closed');
    const [sales, rets, pending] = await Promise.all([
      tx.get(col('sales').where('shiftId', '==', input.shiftId)), tx.get(col('returns').where('shiftId', '==', input.shiftId)),
      tx.get(col('posOutbox').where('shiftId', '==', input.shiftId).where('status', '==', 'pending')),
    ]);
    if (!pending.empty) fail(`${pending.size} offline sale${pending.size > 1 ? 's' : ''} not yet synced — reconnect and wait for them to finalise before closing the shift`);
    const counted = countDenominations(input.denominations as never);
    const rows = sales.docs.map((d) => d.data() as Doc);
    const retRows = rets.docs.map((d) => d.data() as Doc).filter((r) => r.kind !== 'void');
    const returns = retRows.flatMap((r) => { const cash = r.cashRefundPaise ?? 0; return [...(cash ? [{ refundPaise: cash, mode: 'CASH' }] : []), ...(r.refundPaise - cash > 0 ? [{ refundPaise: r.refundPaise - cash, mode: 'OTHER' }] : [])]; });
    const paidIn = (input.paidInPaise ?? 0) + (shift.giftCardCashPaise ?? 0);
    const z = zReport({
      openingFloatPaise: shift.openingFloatPaise, paidInPaise: paidIn, paidOutPaise: input.paidOutPaise ?? 0, countedCashPaise: counted, returns,
      sales: rows.map((s) => ({ totals: (s.payments as Doc[]).map((p) => ({ mode: p.mode, amountPaise: p.amountPaise })), netPaise: s.payablePaise, discountPaise: s.discountPaise, taxPaise: s.totalTaxPaise, changeGivenPaise: s.changeGivenPaise ?? 0, voided: s.status === 'voided' })),
    });
    let approvedBy: string | undefined;
    if (Math.abs(z.variancePaise) > Z_VARIANCE_TOLERANCE_PAISE) approvedBy = (await requireManagerPin(shift.storeId, input.managerPin)).name;
    const zRef = col('zReports').doc(input.shiftId);
    const zDoc = {
      shiftId: input.shiftId, shiftNo: shift.shiftNo, storeId: shift.storeId, tillId: shift.tillId, cashierName: shift.openedByName, openedAt: shift.openedAt, closedAt: Timestamp.now(),
      openingFloatPaise: shift.openingFloatPaise, ...z, denominations: input.denominations, paidInPaise: paidIn, paidOutPaise: input.paidOutPaise ?? 0,
      managerApprovedBy: approvedBy ?? null, note: input.note ?? null, voidCount: rows.filter((s) => s.status === 'voided').length, returnCount: retRows.length,
    };
    tx.set(zRef, zDoc);
    tx.update(shiftRef, { status: 'closed', closedAt: FieldValue.serverTimestamp(), zReportId: input.shiftId });
    tx.update(col('tills').doc(shift.tillId), { openShiftId: null, openShiftNo: null });
    audit(tx, c, { action: 'shift_close', entity: 'shifts', entityId: input.shiftId, before: { status: 'open' }, after: { variancePaise: z.variancePaise, expectedCashPaise: z.expectedCashPaise, approvedBy: approvedBy ?? null } });
    return { id: input.shiftId, ...z, shiftNo: shift.shiftNo, openedAt: isoOf(shift.openedAt), closedAt: new Date().toISOString(), managerApprovedBy: approvedBy };
  });
}
