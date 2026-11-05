import { z } from 'zod';

/** Phase 6 (HR Core) operational collections, read through the generic `scm` repo. `employees`/`hrShifts`/`leaveTypes`/… are masters (masters.ts). */
export const HR_COLLECTIONS = ['candidates', 'onboardingTasks', 'attendance', 'leaveRequests', 'rosters', 'footfallHourly'] as const;
export type HrCollection = (typeof HR_COLLECTIONS)[number];

export const RECRUITMENT_STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const;
export const LEAVE_STATUSES = ['pending', 'approved', 'rejected'] as const;

const id = z.string().min(1).max(100);

export const AddCandidateInput = z.object({
  name: z.string().min(2).max(120), mobile: z.string().min(6).max(20), email: z.string().email().nullish(),
  designationId: id, storeId: id.nullish(), note: z.string().max(400).nullish(),
});
export const MoveCandidateStageInput = z.object({ candidateId: id, stage: z.enum(RECRUITMENT_STAGES) });
export const ToggleOnboardingTaskInput = z.object({ employeeId: id, taskKey: z.string().min(1).max(60), done: z.boolean() });
export const CheckInInput = z.object({ employeeId: id, storeId: id, lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export const CheckOutInput = z.object({ employeeId: id });
export const ApplyLeaveInput = z.object({ employeeId: id, leaveTypeId: id, fromDate: z.string().min(8).max(12), toDate: z.string().min(8).max(12), reason: z.string().max(300).nullish() });
export const DecideLeaveInput = z.object({ leaveRequestId: id, approve: z.boolean(), note: z.string().max(300).nullish() });
export const SaveRosterInput = z.object({
  storeId: id, weekStart: z.string().min(8).max(12),
  days: z.array(z.object({ date: z.string().min(8).max(12), shifts: z.array(z.object({ shiftId: id, employeeIds: z.array(id).max(30) })).max(10) })).min(1).max(7),
});

export const HR_COMMAND_SCHEMAS = {
  addCandidate: AddCandidateInput, moveCandidateStage: MoveCandidateStageInput, toggleOnboardingTask: ToggleOnboardingTaskInput,
  checkIn: CheckInInput, checkOut: CheckOutInput, applyLeave: ApplyLeaveInput, decideLeave: DecideLeaveInput, saveRoster: SaveRosterInput,
} as const;
export type HrCommandName = keyof typeof HR_COMMAND_SCHEMAS;
