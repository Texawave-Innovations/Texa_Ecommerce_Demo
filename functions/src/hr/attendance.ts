import type { z } from 'zod';
import type { CheckInInput, CheckOutInput } from '@texafashions/types';
import { checkGeofence } from '@texafashions/domain';
import { col, db, type Caller } from '../admin';
import { audit, fail, must, requireLocation, stamp, ymd } from '../engine';

async function storeGeo(storeId: string) {
  const s = must((await col('stores').doc(storeId).get()).data() as Record<string, unknown> | undefined, `Store ${storeId} not found`);
  const lat = Number(s.lat), lng = Number(s.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) fail(`Store ${storeId} has no coordinates set`);
  return { lat, lng, radiusM: Number(s.geofenceMeters ?? 150) };
}

/** Selfie check-in: rejected outside the store's geofence (the selfie itself is a UI affordance — the demo doesn't verify the image). */
export async function checkIn(c: Caller, i: z.output<typeof CheckInInput>) {
  requireLocation(c, i.storeId);
  const geo = await storeGeo(i.storeId);
  const g = checkGeofence(i.lat, i.lng, geo.lat, geo.lng, geo.radiusM);
  if (!g.ok) fail(`You're ${g.distanceM}m from ${i.storeId} — move within ${geo.radiusM}m to check in`);
  const date = ymd();
  const ref = col('attendance').doc(`${i.employeeId}_${date}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.get('checkInAt')) fail('Already checked in today');
    tx.set(ref, {
      employeeId: i.employeeId, storeId: i.storeId, date,
      checkInAt: stamp(), checkInLoc: { lat: i.lat, lng: i.lng }, distanceM: g.distanceM, geofenceOk: true,
      checkOutAt: null, status: 'present', createdAt: stamp(), updatedAt: stamp(),
    }, { merge: true });
    audit(tx, c, { action: 'check_in', entity: 'attendance', entityId: ref.id, before: null, after: { date, distanceM: g.distanceM } });
    return { date, distanceM: g.distanceM, status: 'present' };
  });
}

export async function checkOut(c: Caller, i: z.output<typeof CheckOutInput>) {
  const date = ymd();
  const ref = col('attendance').doc(`${i.employeeId}_${date}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const doc = must(snap.data() as Record<string, unknown> | undefined, 'No check-in found for today');
    if (doc.checkOutAt) fail('Already checked out today');
    tx.update(ref, { checkOutAt: stamp(), updatedAt: stamp() });
    audit(tx, c, { action: 'check_out', entity: 'attendance', entityId: ref.id, before: null, after: { date } });
    return { date, status: 'present' };
  });
}
