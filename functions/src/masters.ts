import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  BulkImportInput, MasterChangeInput, buildMasterSchema, canApproveMaster, canEditMaster, getMaster, searchKeywordsFor,
  type MasterDef,
} from '@texafashions/types';
import { findDuplicateCandidates } from '@texafashions/domain';
import { FieldValue, REGION, col, db, parseInput, requireCaller, writeAudit, type Caller } from './admin';
import { ANTHROPIC_API_KEY, claudeText } from './claude';

const opts = { region: REGION, cors: true } as const;

function parseMaster(key: string): MasterDef {
  try { return getMaster(key); } catch { throw new HttpsError('invalid-argument', `Unknown master ${key}`); }
}

function validateData(def: MasterDef, data: Record<string, unknown>) {
  const r = buildMasterSchema(def).safeParse(data);
  if (!r.success) {
    throw new HttpsError('invalid-argument', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return r.data as Record<string, unknown>;
}

/** SKU barcode / any "unique" business rules checked against current data. */
async function checkUniqueness(def: MasterDef, id: string, data: Record<string, unknown>) {
  if (def.key === 'skus' && data.barcode) {
    const q = await col('skus').where('barcode', '==', data.barcode).limit(2).get();
    if (q.docs.some((d) => d.id !== id)) throw new HttpsError('already-exists', `Barcode ${data.barcode} already used by another SKU`);
  }
}

export const submitMasterChange = onCall(opts, async (req) => {
  const caller = requireCaller(req);
  const input = parseInput(MasterChangeInput, req.data);
  const def = parseMaster(input.master);
  if (!canEditMaster(caller.claims.role, def.key)) throw new HttpsError('permission-denied', `Role cannot edit ${def.label}`);

  const ref = col(def.key).doc(input.id);
  const snap = await ref.get();
  const before = snap.exists ? (snap.data() as Record<string, unknown>) : null;
  if (input.kind === 'create' && before) throw new HttpsError('already-exists', `${def.singular} ${input.id} already exists`);
  if (input.kind !== 'create' && !before) throw new HttpsError('not-found', `${def.singular} ${input.id} not found`);

  let after: Record<string, unknown>;
  if (input.kind !== 'deactivate') {
    const merged = { ...(before ?? {}), ...input.data, [def.codeField]: input.id };
    after = validateData(def, stripSystem(merged));
    await checkUniqueness(def, input.id, after);
  } else {
    after = { ...(before as object), status: 'inactive' };
  }

  const aref = col('approvals').doc();
  const batch = db.batch();
  batch.set(aref, {
    type: 'master', master: def.key, kind: input.kind, docId: input.id,
    before: before ? stripSystem(before) : null, after: stripSystem(after), note: input.note ?? null,
    status: 'pending', requestedBy: caller.uid, requestedByName: caller.name, requestedAt: FieldValue.serverTimestamp(),
  });
  writeAudit(batch, caller, { action: 'submit_master_change', entity: def.key, entityId: input.id, before: null, after: { approvalId: aref.id, kind: input.kind } });
  await batch.commit();
  return { approvalId: aref.id };
});

export const importMasters = onCall(opts, async (req) => {
  const caller = requireCaller(req);
  const input = parseInput(BulkImportInput, req.data);
  const def = parseMaster(input.master);
  if (!canEditMaster(caller.claims.role, def.key)) throw new HttpsError('permission-denied', `Role cannot edit ${def.label}`);
  const errors: { row: number; message: string }[] = [];
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  input.rows.forEach((raw, i) => {
    const r = buildMasterSchema(def).safeParse(raw);
    if (!r.success) { errors.push({ row: i + 1, message: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') }); return; }
    const id = String(r.data[def.codeField] ?? '');
    if (!id) { errors.push({ row: i + 1, message: `${def.codeField} missing` }); return; }
    if (seen.has(id)) { errors.push({ row: i + 1, message: `Duplicate code ${id} in file` }); return; }
    seen.add(id);
    rows.push(r.data as Record<string, unknown>);
  });
  if (errors.length) throw new HttpsError('invalid-argument', 'Validation failed', { errors });
  const aref = col('approvals').doc();
  const batch = db.batch();
  batch.set(aref, {
    type: 'master', master: def.key, kind: 'bulk', docId: null, before: null, after: null, rows, note: input.note ?? `Bulk import of ${rows.length} rows`,
    status: 'pending', requestedBy: caller.uid, requestedByName: caller.name, requestedAt: FieldValue.serverTimestamp(),
  });
  writeAudit(batch, caller, { action: 'submit_bulk_import', entity: def.key, entityId: aref.id, before: null, after: { rows: rows.length } });
  await batch.commit();
  return { approvalId: aref.id, rows: rows.length };
});

const DecisionInput = z.object({ approvalId: z.string(), approve: z.boolean(), note: z.string().nullish() });

export const decideApproval = onCall(opts, async (req) => {
  const caller = requireCaller(req);
  const { approvalId, approve, note } = parseInput(DecisionInput, req.data);
  const aref = col('approvals').doc(approvalId);
  const a = await aref.get();
  if (!a.exists) throw new HttpsError('not-found', 'Approval not found');
  const ap = a.data() as Record<string, any>;
  const def = parseMaster(ap.master);
  if (!canApproveMaster(caller.claims.role, def.key)) throw new HttpsError('permission-denied', 'Role cannot approve this master');
  if (ap.requestedBy === caller.uid) throw new HttpsError('permission-denied', 'Maker-checker: you cannot approve your own change');

  await db.runTransaction(async (tx) => {
    const cur = await tx.get(aref);
    if (cur.data()?.status !== 'pending') throw new HttpsError('failed-precondition', 'Already decided');

    if (approve) {
      const items: { id: string; data: Record<string, unknown>; kind: string }[] =
        ap.kind === 'bulk'
          ? (ap.rows as Record<string, unknown>[]).map((r) => ({ id: String(r[def.codeField]), data: r, kind: 'import' }))
          : [{ id: ap.docId, data: ap.after, kind: ap.kind }];
      const refs = items.map((i) => col(def.key).doc(i.id));
      const existing = await tx.getAll(...refs);
      items.forEach((it, idx) => {
        const ex = existing[idx]!;
        const prev = ex.exists ? (ex.data() as Record<string, any>) : null;
        const version = ((prev?.version as number | undefined) ?? 0) + 1;
        const data = {
          ...stripSystem(it.data),
          [def.codeField]: it.id,
          status: it.kind === 'deactivate' ? 'inactive' : (it.data.status ?? 'active'),
          version,
          searchKeywords: searchKeywordsFor(def, it.data),
          updatedAt: FieldValue.serverTimestamp(), updatedBy: ap.requestedBy,
          ...(prev ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: ap.requestedBy }),
        };
        tx.set(refs[idx]!, data, { merge: true });
        tx.set(refs[idx]!.collection('versions').doc(String(version).padStart(5, '0')), {
          version, data: stripSystem(it.data), kind: it.kind, changedBy: ap.requestedBy, changedAt: FieldValue.serverTimestamp(), approvedBy: caller.uid,
        });
      });
      writeAudit(tx, caller, { action: 'approve_master_change', entity: def.key, entityId: ap.docId ?? approvalId, before: ap.before, after: ap.kind === 'bulk' ? { rows: items.length } : ap.after });
    } else {
      writeAudit(tx, caller, { action: 'reject_master_change', entity: def.key, entityId: ap.docId ?? approvalId, before: ap.before, after: { note: note ?? null } });
    }
    tx.update(aref, { status: approve ? 'approved' : 'rejected', decidedBy: caller.uid, decidedAt: FieldValue.serverTimestamp(), decisionNote: note ?? null });
  });
  return { ok: true };
});

export const detectDuplicates = onCall({ ...opts, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120 }, async (req) => {
  const caller = requireCaller(req);
  const { master } = parseInput(z.object({ master: z.string() }), req.data);
  const def = parseMaster(master);
  if (!canEditMaster(caller.claims.role, def.key) && !canApproveMaster(caller.claims.role, def.key) && caller.claims.role !== 'auditor') throw new HttpsError('permission-denied', 'Not allowed');
  const snap = await col(def.key).where('status', '==', 'active').limit(800).get();
  const items = snap.docs.map((d) => ({ id: d.id, name: String(d.get(def.nameField) ?? ''), variant: [d.get('colour'), d.get('size'), d.get('character')].map((x) => x ?? '').join('|') }));
  const candidates = findDuplicateCandidates(items, 0.85, 25);
  let usedClaude = false;
  if (candidates.length) {
    try {
      const txt = await claudeText(
        'You review retail master data for duplicates. Reply ONLY with JSON: [{"a":"id","b":"id","duplicate":true|false,"reason":"short"}]. Different colour/size/character variants are NOT duplicates.',
        JSON.stringify(candidates.map((c) => ({ a: c.a, b: c.b, aName: items.find((i) => i.id === c.a), bName: items.find((i) => i.id === c.b) }))),
      );
      if (txt) {
        const verdicts = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1)) as { a: string; b: string; duplicate: boolean; reason: string }[];
        usedClaude = true;
        return { usedClaude, candidates: candidates.flatMap((c) => {
          const v = verdicts.find((x) => x.a === c.a && x.b === c.b);
          return v && !v.duplicate ? [] : [{ ...c, reason: v?.reason ?? c.reason }];
        }) };
      }
    } catch (e) { console.warn('Claude duplicate review failed, using fallback', e); }
  }
  return { usedClaude, candidates };
});

function stripSystem<T extends Record<string, unknown> | null>(o: T): T {
  if (!o) return o;
  const { searchKeywords, createdAt, createdBy, updatedAt, updatedBy, version, versions, id, ...rest } = o as Record<string, unknown>;
  void searchKeywords; void createdAt; void createdBy; void updatedAt; void updatedBy; void version; void versions; void id;
  return rest as T;
}
export type { Caller };
