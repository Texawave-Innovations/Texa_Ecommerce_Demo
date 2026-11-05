import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import { PosPinLoginInput, PosStaffListInput, VerifyManagerPinInput } from '@texafashions/types';
import { REGION, col, parseInput, type Caller } from '../admin';

export const hashPin = (pin: string, salt = randomBytes(16).toString('hex')) => ({ salt, pinHash: scryptSync(pin, salt, 32).toString('hex') });
const matches = (pin: string, u: { salt: string; pinHash: string }) => {
  const a = Buffer.from(scryptSync(pin, u.salt, 32).toString('hex')); const b = Buffer.from(u.pinHash);
  return a.length === b.length && timingSafeEqual(a, b);
};
const LOCK_AFTER = 5, LOCK_MS = 60_000;

/** Names only — never PIN material. Public so the login screen can show the till's staff. */
export const posStaffList = onCall({ region: REGION, cors: true }, async (req) => {
  const { storeId } = parseInput(PosStaffListInput, req.data);
  const s = await col('posUsers').where('storeIds', 'array-contains', storeId).get();
  return s.docs.map((d) => ({ employeeCode: d.get('employeeCode') as string, name: d.get('name') as string, role: d.get('role') as string }));
});

async function checkPin(ref: FirebaseFirestore.DocumentReference, pin: string): Promise<Record<string, any>> {
  const snap = await ref.get(); const u = snap.data();
  if (!u) throw new HttpsError('permission-denied', 'Unknown staff member');
  if (u.lockedUntil && u.lockedUntil > Date.now()) throw new HttpsError('resource-exhausted', `Too many wrong PINs — try again in ${Math.ceil((u.lockedUntil - Date.now()) / 1000)}s`);
  if (!matches(pin, u as never)) {
    const fails = (u.failCount ?? 0) + 1;
    await ref.update(fails >= LOCK_AFTER ? { failCount: 0, lockedUntil: Date.now() + LOCK_MS } : { failCount: fails });
    throw new HttpsError('permission-denied', 'Wrong PIN');
  }
  if (u.failCount || u.lockedUntil) await ref.update({ failCount: 0, lockedUntil: 0 });
  return u;
}

export const posPinLogin = onCall({ region: REGION, cors: true }, async (req) => {
  const { storeId, employeeCode, pin } = parseInput(PosPinLoginInput, req.data);
  const u = await checkPin(col('posUsers').doc(`${storeId}_${employeeCode}`), pin);
  const auth = getAuth();
  const claims = { role: u.role, storeIds: u.storeIds, approvalLimitPaise: u.role === 'store_manager' ? 10_000_000 : 0 };
  try { await auth.getUser(u.uid); } catch { await auth.createUser({ uid: u.uid, displayName: u.name, email: `${u.uid}@texafashions.demo`, password: randomBytes(12).toString('hex') }); }
  await auth.setCustomUserClaims(u.uid, claims);
  return { token: await auth.createCustomToken(u.uid, claims), displayName: u.name, role: u.role, storeIds: u.storeIds };
});

/** Verifies any store manager's PIN for the store; used by overrides, big returns, voids and Z-report variance sign-off. */
export async function requireManagerPin(storeId: string, pin: string | null | undefined): Promise<{ id: string; name: string }> {
  if (!pin) throw new HttpsError('permission-denied', 'Manager PIN required');
  const mgrs = await col('posUsers').where('storeIds', 'array-contains', storeId).where('role', '==', 'store_manager').get();
  for (const d of mgrs.docs) {
    const u = d.data();
    if (u.lockedUntil && u.lockedUntil > Date.now()) continue;
    if (matches(pin, u as never)) return { id: u.uid as string, name: u.name as string };
  }
  throw new HttpsError('permission-denied', 'Manager PIN not recognised');
}

export async function verifyManagerPin(_c: Caller, input: z.output<typeof VerifyManagerPinInput>) {
  try { const m = await requireManagerPin(input.storeId, input.pin); return { ok: true, managerId: m.id, managerName: m.name }; }
  catch { return { ok: false }; }
}
