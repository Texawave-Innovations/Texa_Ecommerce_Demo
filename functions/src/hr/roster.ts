import type { z } from 'zod';
import type { SaveRosterInput } from '@texafashions/types';
import { col, db, type Caller } from '../admin';
import { audit, fail, requireLocation, requireRoles, stamp } from '../engine';

export async function saveRoster(c: Caller, i: z.output<typeof SaveRosterInput>) {
  requireRoles(c, 'hr_manager', 'store_manager');
  requireLocation(c, i.storeId);
  for (const day of i.days) {
    const seen = new Set<string>();
    for (const sh of day.shifts) for (const e of sh.employeeIds) {
      if (seen.has(e)) fail(`${e} is double-booked on ${day.date}`);
      seen.add(e);
    }
  }
  const ref = col('rosters').doc(`${i.storeId}_${i.weekStart}`);
  const batch = db.batch();
  batch.set(ref, { storeId: i.storeId, weekStart: i.weekStart, days: i.days, updatedAt: stamp(), updatedBy: c.uid }, { merge: true });
  audit(batch, c, { action: 'save_roster', entity: 'rosters', entityId: ref.id, before: null, after: { storeId: i.storeId, weekStart: i.weekStart } });
  await batch.commit();
  return { rosterId: ref.id };
}
