import type { z } from 'zod';
import type { ToggleOnboardingTaskInput } from '@texafashions/types';
import { col, db, type Caller } from '../admin';
import { audit, must, requireRoles, stamp } from '../engine';

export async function toggleOnboardingTask(c: Caller, i: z.output<typeof ToggleOnboardingTaskInput>) {
  requireRoles(c, 'hr_manager', 'store_manager');
  const ref = col('onboardingTasks').doc(i.employeeId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const doc = must(snap.data() as Record<string, unknown> | undefined, 'Onboarding checklist not found');
    const items = (doc.items as { key: string; label: string; done: boolean; doneAt: string | null }[]).map((t) =>
      t.key === i.taskKey ? { ...t, done: i.done, doneAt: i.done ? new Date().toISOString() : null } : t);
    const allDone = items.every((t) => t.done);
    tx.update(ref, { items, completedAt: allDone ? stamp() : null, updatedAt: stamp() });
    audit(tx, c, { action: 'onboarding_task', entity: 'onboardingTasks', entityId: i.employeeId, before: { taskKey: i.taskKey }, after: { done: i.done } });
    return { items, completed: allDone };
  });
}
