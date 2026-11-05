import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { z } from 'zod';
import { ClaimsSchema, DEMO_USERS, Role } from '@texafashions/types';
import { REGION, parseInput, requireCaller, requireRole, writeAudit, db } from './admin';

/**
 * Demo role switcher. Demo deployment only: set ALLOW_DEMO_LOGIN=false to disable.
 * Creates the demo user on demand, sets custom claims, returns a custom token.
 */
export const demoSignIn = onCall({ region: REGION, cors: true }, async (req) => {
  if (process.env.ALLOW_DEMO_LOGIN === 'false') throw new HttpsError('failed-precondition', 'Demo login disabled');
  const { role } = parseInput(z.object({ role: Role }), req.data);
  const u = DEMO_USERS.find((d) => d.role === role)!;
  const auth = getAuth();
  try { await auth.getUser(u.uid); }
  catch { await auth.createUser({ uid: u.uid, email: u.email, displayName: u.displayName, password: 'demo-demo-1' }); }
  const claims = { role: u.role, storeIds: u.storeIds, approvalLimitPaise: u.approvalLimitPaise, ...(u.vendorId ? { vendorId: u.vendorId } : {}) };
  await auth.setCustomUserClaims(u.uid, claims);
  return { token: await auth.createCustomToken(u.uid), displayName: u.displayName };
});

const SetClaimsInput = z.object({ uid: z.string(), claims: ClaimsSchema });

/** Super Admin only. Takes effect on the user's next token refresh. */
export const setClaims = onCall({ region: REGION, cors: true }, async (req) => {
  const caller = requireCaller(req);
  requireRole(caller, 'super_admin');
  const { uid, claims } = parseInput(SetClaimsInput, req.data);
  const auth = getAuth();
  const user = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, claims);
  const batch = db.batch();
  writeAudit(batch, caller, { action: 'set_claims', entity: 'user', entityId: uid, before: user.customClaims ?? null, after: claims });
  await batch.commit();
  return { ok: true };
});

export const listUsers = onCall({ region: REGION, cors: true }, async (req) => {
  const caller = requireCaller(req);
  requireRole(caller, 'super_admin', 'auditor');
  const res = await getAuth().listUsers(200);
  return res.users.map((u) => ({
    uid: u.uid, email: u.email ?? '', displayName: u.displayName ?? '', claims: u.customClaims ?? null, disabled: u.disabled,
  }));
});
