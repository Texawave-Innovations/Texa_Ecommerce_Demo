/** HR Core — pure logic: recruitment pipeline, geofenced attendance, leave balances, AI roster suggestion. */

export const RECRUITMENT_STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const;
export type RecruitmentStage = (typeof RECRUITMENT_STAGES)[number];
/** A candidate can only move forward one stage at a time, or be rejected from any open stage. */
export function canMoveStage(from: RecruitmentStage, to: RecruitmentStage): boolean {
  if (from === 'hired' || from === 'rejected') return false;
  if (to === 'rejected') return true;
  const i = RECRUITMENT_STAGES.indexOf(from);
  return RECRUITMENT_STAGES.indexOf(to) === i + 1;
}

/** Haversine distance in metres between two lat/lng points. */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat); const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export interface GeofenceResult { distanceM: number; ok: boolean }
/** Selfie check-in is accepted only inside the store's geofence radius. */
export function checkGeofence(empLat: number, empLng: number, storeLat: number, storeLng: number, radiusM: number): GeofenceResult {
  const distanceM = Math.round(haversineMeters(empLat, empLng, storeLat, storeLng));
  return { distanceM, ok: distanceM <= radiusM };
}

export interface LeaveBalance { leaveTypeId: string; quota: number; taken: number; pending: number; available: number }
/** Opening quota minus already-approved and pending days this year (unpaid leave types have no cap, so taken never blocks). */
export function leaveBalance(annualQuota: number, approvedDays: number, pendingDays: number): LeaveBalance {
  const taken = approvedDays; const pending = pendingDays;
  const available = annualQuota === 0 ? Infinity : Math.max(0, annualQuota - taken - pending);
  return { leaveTypeId: '', quota: annualQuota, taken, pending, available };
}
export function inclusiveDays(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export interface ShiftDef { id: string; startHour: number; endHour: number }
export interface RosterEmployee { id: string; name: string }
export interface RosterAssignment { shiftId: string; employeeIds: string[]; requiredHeadcount: number }
/** Footfall → headcount rule: staff = ceil(avg hourly footfall during the shift / 25), minimum 1 if the store is open that shift. */
export function requiredHeadcount(hourlyFootfall: number[], shift: ShiftDef): number {
  const hours = Array.from({ length: shift.endHour - shift.startHour }, (_, k) => shift.startHour + k);
  const relevant = hours.map((h) => hourlyFootfall[h] ?? 0);
  if (!relevant.length) return 0;
  const avg = relevant.reduce((a, b) => a + b, 0) / relevant.length;
  return Math.max(1, Math.ceil(avg / 25));
}
/**
 * Fills a day's shifts from footfall: computes headcount per shift, then assigns employees round-robin
 * (by least shifts-so-far this week) so no one is double-booked the same day.
 */
export function suggestDayRoster(employees: RosterEmployee[], shifts: ShiftDef[], hourlyFootfall: number[], shiftsSoFar: Record<string, number>): RosterAssignment[] {
  const used = new Set<string>();
  const order = [...employees].sort((a, b) => (shiftsSoFar[a.id] ?? 0) - (shiftsSoFar[b.id] ?? 0));
  return shifts.map((shift) => {
    const requiredHc = requiredHeadcount(hourlyFootfall, shift);
    const picked: string[] = [];
    for (const e of order) {
      if (picked.length >= requiredHc) break;
      if (used.has(e.id)) continue;
      used.add(e.id); picked.push(e.id); shiftsSoFar[e.id] = (shiftsSoFar[e.id] ?? 0) + 1;
    }
    return { shiftId: shift.id, employeeIds: picked, requiredHeadcount: requiredHc };
  });
}

export const ONBOARDING_TASKS = [
  { key: 'offer_signed', label: 'Signed offer letter collected' },
  { key: 'kyc', label: 'KYC documents (Aadhaar / PAN) verified' },
  { key: 'bank', label: 'Bank account & UAN captured' },
  { key: 'uniform', label: 'Uniform / badge issued' },
  { key: 'pos_training', label: 'POS / systems training' },
  { key: 'induction', label: 'Store induction walkthrough' },
] as const;
export type OnboardingTaskKey = (typeof ONBOARDING_TASKS)[number]['key'];
