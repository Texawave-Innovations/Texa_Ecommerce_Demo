import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp, type Transaction, type WriteBatch } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { ClaimsSchema, ORG_ID, type Claims } from '@texafashions/types';

if (getApps().length === 0) initializeApp();
export const db = getFirestore();
// Optional zod fields arrive as undefined when handlers are called in-process (seed/tests); never write them.
try { db.settings({ ignoreUndefinedProperties: true }); } catch { /* already initialised */ }
export { FieldValue, Timestamp };
export const REGION = 'asia-south1';

export const org = () => db.collection('orgs').doc(ORG_ID);
export const col = (name: string) => org().collection(name);

export interface Caller { uid: string; name: string; claims: Claims }

/** Every function re-checks permissions from the verified token claims. */
export function requireCaller(req: CallableRequest<unknown>): Caller {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const parsed = ClaimsSchema.safeParse(req.auth.token);
  if (!parsed.success) throw new HttpsError('permission-denied', 'No role assigned to this account');
  return { uid: req.auth.uid, name: (req.auth.token.name as string | undefined) ?? req.auth.uid, claims: parsed.data };
}

export function requireRole(c: Caller, ...roles: Claims['role'][]) {
  if (!roles.includes(c.claims.role)) throw new HttpsError('permission-denied', `Role ${c.claims.role} cannot do this`);
}

type Writer = Transaction | WriteBatch;

/** Append an audit record. Pass the same tx/batch as the change so they commit together. */
export function writeAudit(w: Writer, c: Caller, entry: { action: string; entity: string; entityId: string; before: unknown; after: unknown }) {
  const ref = col('auditLogs').doc();
  (w as { set(r: typeof ref, d: object): unknown }).set(ref, {
    ...entry,
    before: entry.before ?? null,
    after: entry.after ?? null,
    userId: c.uid, userName: c.name, role: c.claims.role,
    at: FieldValue.serverTimestamp(),
  });
}

/** zod parse that turns validation failures into proper invalid-argument errors (not INTERNAL 500s). */
export function parseInput<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpsError('invalid-argument', r.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; '));
  return r.data;
}

