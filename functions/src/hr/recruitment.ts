import type { z } from 'zod';
import { MASTER_MAP, searchKeywordsFor, type AddCandidateInput, type MoveCandidateStageInput } from '@texafashions/types';
import { canMoveStage, ONBOARDING_TASKS, type RecruitmentStage } from '@texafashions/domain';
import { col, db, type Caller } from '../admin';
import { audit, fail, must, requireRoles, stamp } from '../engine';

const HR_ROLES = ['hr_manager', 'store_manager'] as const;
const kw = (name: string, mobile: string) => [...name.toLowerCase().trim().split(/\s+/), mobile];

export async function addCandidate(c: Caller, i: z.output<typeof AddCandidateInput>) {
  requireRoles(c, ...HR_ROLES);
  const ref = col('candidates').doc();
  await ref.set({
    name: i.name, mobile: i.mobile, email: i.email ?? null, designationId: i.designationId, storeId: i.storeId ?? null,
    note: i.note ?? null, stage: 'applied' as RecruitmentStage, searchKeywords: kw(i.name, i.mobile),
    appliedAt: stamp(), updatedAt: stamp(), createdBy: c.uid,
  });
  return { candidateId: ref.id };
}

/** Moving to `hired` also mints an employee master record (next `E-####` code) and an onboarding checklist — the recruitment → onboarding → employee handoff. */
export async function moveCandidateStage(c: Caller, i: z.output<typeof MoveCandidateStageInput>) {
  requireRoles(c, ...HR_ROLES);
  const ref = col('candidates').doc(i.candidateId);
  const def = MASTER_MAP.employees!;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cand = must(snap.data() as Record<string, unknown> | undefined, 'Candidate not found');
    const from = cand.stage as RecruitmentStage;
    if (!canMoveStage(from, i.stage)) fail(`Cannot move from ${from} to ${i.stage}`);
    let employeeId: string | undefined;
    if (i.stage === 'hired') {
      const cRef = col('counters').doc('employee_seq');
      const cSnap = await tx.get(cRef);
      const seq = ((cSnap.get('seq') as number | undefined) ?? 60) + 1;
      employeeId = `E-${String(seq).padStart(4, '0')}`;
      const data = {
        code: employeeId, name: cand.name, storeId: cand.storeId ?? null, designationId: cand.designationId,
        mobile: cand.mobile, email: cand.email ?? null, doj: new Date().toISOString().slice(0, 10),
      };
      tx.set(cRef, { seq, updatedAt: stamp() }, { merge: true });
      tx.set(col('employees').doc(employeeId), { ...data, status: 'active', version: 1, searchKeywords: searchKeywordsFor(def, data), createdAt: stamp(), updatedAt: stamp(), createdBy: c.uid, updatedBy: c.uid });
      tx.set(col('employees').doc(employeeId).collection('versions').doc('00001'), { version: 1, data, kind: 'create', changedBy: c.uid, changedAt: stamp(), approvedBy: c.name });
      tx.set(col('onboardingTasks').doc(employeeId), {
        employeeId, storeId: cand.storeId ?? null,
        items: ONBOARDING_TASKS.map((t) => ({ key: t.key, label: t.label, done: false, doneAt: null })),
        completedAt: null, createdAt: stamp(), updatedAt: stamp(),
      });
    }
    tx.update(ref, { stage: i.stage, updatedAt: stamp(), ...(employeeId ? { employeeId } : {}) });
    audit(tx, c, { action: 'candidate_stage', entity: 'candidates', entityId: i.candidateId, before: { stage: from }, after: { stage: i.stage, employeeId: employeeId ?? null } });
    return { stage: i.stage, employeeId: employeeId ?? null };
  });
}
