/** Phase 6 seed: recruitment kanban, onboarding checklists, 30 days of geofenced attendance, leave requests, a week of hourly footfall, and an AI-suggested roster. */
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { ORG_ID } from '@texafashions/types';
import { suggestDayRoster, type RosterEmployee, type ShiftDef } from '@texafashions/domain';
import { rng } from './rng';

const P = (c: string) => `orgs/${ORG_ID}/${c}`;
const r = rng(7);
const SHIFTS: ShiftDef[] = [{ id: 'SH-MORN', startHour: 10, endHour: 18 }, { id: 'SH-EVE', startHour: 13, endHour: 22 }];
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const mondayOf = (d: Date) => addDays(d, -((d.getUTCDay() + 6) % 7));

interface Store { code: string; lat: number; lng: number }
interface Emp { code: string; name: string; storeId?: string }

/** Bell-curve-ish hourly footfall for a mall store, 10:00–22:00. */
function footfallHours(seedOffset: number): number[] {
  const hours = Array(24).fill(0);
  for (let h = 10; h < 22; h++) {
    const peak = h >= 17 && h <= 20 ? 1.4 : h <= 12 ? 0.6 : 1;
    hours[h] = Math.round((40 + r.int(0, seedOffset % 2 === 0 ? 70 : 50)) * peak);
  }
  return hours;
}

export async function seedHr(db: Firestore, stores: Store[], employees: Emp[]) {
  const today = new Date();
  const batches: Promise<unknown>[] = [];

  // ───────── Footfall: last 7 days, every store.
  let fbatch = db.batch(); let fn = 0;
  const footfallByStoreDate = new Map<string, number[]>();
  for (const s of stores) {
    for (let d = 6; d >= 0; d--) {
      const date = ymd(addDays(today, -d));
      const hours = footfallHours(d + s.code.length);
      footfallByStoreDate.set(`${s.code}_${date}`, hours);
      fbatch.set(db.doc(`${P('footfallHourly')}/${s.code}_${date}`), { storeId: s.code, date, hours, createdAt: FieldValue.serverTimestamp() });
      if (++fn % 300 === 0) { batches.push(fbatch.commit()); fbatch = db.batch(); }
    }
  }
  batches.push(fbatch.commit());
  await Promise.all(batches);

  // ───────── Attendance: 30 days, every retail employee, checked in at their own store (0m from the pin → inside geofence).
  const staff = employees.filter((e) => e.storeId && stores.some((s) => s.code === e.storeId));
  const byStore = new Map(stores.map((s) => [s.code, s]));
  let abatch = db.batch(); let an = 0;
  for (const e of staff) {
    const store = byStore.get(e.storeId!)!;
    for (let d = 29; d >= 0; d--) {
      const date = ymd(addDays(today, -d));
      const dow = addDays(today, -d).getUTCDay();
      if (dow === 0 && r.chance(0.6)) continue; // most Sundays off
      const roll = r.next();
      const status = roll < 0.04 ? 'absent' : roll < 0.12 ? 'late' : 'present';
      const ref = db.doc(`${P('attendance')}/${e.code}_${date}`);
      if (status === 'absent') { abatch.set(ref, { employeeId: e.code, storeId: store.code, date, status, checkInAt: null, checkOutAt: null, geofenceOk: null, distanceM: null, createdAt: FieldValue.serverTimestamp() }); }
      else {
        const jitter = r.int(-30, 30) / 100_000; // ~±3m, always inside geofence
        const checkInAt = new Date(addDays(today, -d).setUTCHours(status === 'late' ? 10 + r.int(0, 1) : 9, r.int(0, 45), 0, 0));
        const checkOutAt = new Date(checkInAt.getTime() + (8 + r.int(0, 1)) * 3600_000);
        abatch.set(ref, {
          employeeId: e.code, storeId: store.code, date, status,
          checkInAt: checkInAt.toISOString(), checkOutAt: checkOutAt.toISOString(),
          checkInLoc: { lat: store.lat + jitter, lng: store.lng + jitter }, distanceM: r.int(3, 40), geofenceOk: true,
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        });
      }
      if (++an % 400 === 0) { await abatch.commit(); abatch = db.batch(); }
    }
  }
  await abatch.commit();

  // ───────── Recruitment kanban + onboarding.
  const names = ['Ananya Joshi', 'Kabir Malhotra', 'Riya Sen', 'Vikrant Desai', 'Simran Kaur', 'Aditya Rao', 'Pooja Nambiar', 'Yash Khanna'];
  const CAND = [
    { n: names[0]!, stage: 'applied', desig: 'DS-SA', store: 'PUN-PMC' },
    { n: names[1]!, stage: 'applied', desig: 'DS-CSH', store: 'BLR-FS' },
    { n: names[2]!, stage: 'screening', desig: 'DS-SA', store: 'MUM-PMC' },
    { n: names[3]!, stage: 'screening', desig: 'DS-WH', store: undefined },
    { n: names[4]!, stage: 'interview', desig: 'DS-ASM', store: 'HYD-NX' },
    { n: names[5]!, stage: 'interview', desig: 'DS-SA', store: 'BLR-M5' },
    { n: names[6]!, stage: 'offer', desig: 'DS-SM', store: 'NSK-CC' },
    { n: names[7]!, stage: 'rejected', desig: 'DS-SA', store: 'HYD-SC' },
  ];
  const cbatch = db.batch();
  CAND.forEach((cnd, i) => {
    cbatch.set(db.doc(`${P('candidates')}/CAND-${String(i + 1).padStart(3, '0')}`), {
      name: cnd.n, mobile: `9${800000000 + i}`, email: `${cnd.n.toLowerCase().replace(/\s+/, '.')}@mail.com`, designationId: cnd.desig, storeId: cnd.store ?? null,
      note: null, stage: cnd.stage, searchKeywords: cnd.n.toLowerCase().split(/\s+/), appliedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdBy: 'seed',
    });
  });
  await cbatch.commit();
  await db.doc(`${P('counters')}/employee_seq`).set({ seq: employees.length, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  // Onboarding checklists: the 3 newest hires, at varying progress.
  const TASKS = [
    { key: 'offer_signed', label: 'Signed offer letter collected' }, { key: 'kyc', label: 'KYC documents (Aadhaar / PAN) verified' },
    { key: 'bank', label: 'Bank account & UAN captured' }, { key: 'uniform', label: 'Uniform / badge issued' },
    { key: 'pos_training', label: 'POS / systems training' }, { key: 'induction', label: 'Store induction walkthrough' },
  ];
  const newest = staff.slice(-3);
  const obatch = db.batch();
  newest.forEach((e, i) => {
    const doneCount = i === 0 ? TASKS.length : i; // last hire fully onboarded, others in progress
    obatch.set(db.doc(`${P('onboardingTasks')}/${e.code}`), {
      employeeId: e.code, storeId: e.storeId, items: TASKS.map((t, j) => ({ ...t, done: j < doneCount, doneAt: j < doneCount ? new Date().toISOString() : null })),
      completedAt: doneCount === TASKS.length ? FieldValue.serverTimestamp() : null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await obatch.commit();

  // ───────── Leave requests: a mix of approved history and a couple pending for the approval queue.
  const leaveTypes = ['LT-CL', 'LT-SL', 'LT-PL'];
  const lbatch = db.batch();
  staff.slice(0, 10).forEach((e, i) => {
    const from = addDays(today, -(10 + i * 3));
    lbatch.set(db.doc(`${P('leaveRequests')}/LV-${String(i + 1).padStart(3, '0')}`), {
      employeeId: e.code, leaveTypeId: r.pick(leaveTypes), fromDate: ymd(from), toDate: ymd(addDays(from, r.int(0, 1))), days: r.int(1, 2), reason: 'Personal',
      status: 'approved', appliedAt: FieldValue.serverTimestamp(), decidedAt: FieldValue.serverTimestamp(), decidedBy: 'demo-hr', note: null, updatedAt: FieldValue.serverTimestamp(),
    });
  });
  staff.slice(10, 13).forEach((e, i) => {
    const from = addDays(today, 2 + i);
    lbatch.set(db.doc(`${P('leaveRequests')}/LV-PEND-${i + 1}`), {
      employeeId: e.code, leaveTypeId: r.pick(leaveTypes), fromDate: ymd(from), toDate: ymd(from), days: 1, reason: 'Family function',
      status: 'pending', appliedAt: FieldValue.serverTimestamp(), decidedAt: null, decidedBy: null, note: null, updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await lbatch.commit();

  // ───────── Roster: AI-suggest next week for every store, using this week's footfall (dogfoods the same domain function the UI button calls).
  const nextMonday = mondayOf(addDays(today, 7));
  const rbatch = db.batch();
  for (const s of stores) {
    const empsForStore: RosterEmployee[] = staff.filter((e) => e.storeId === s.code).map((e) => ({ id: e.code, name: e.name }));
    if (!empsForStore.length) continue;
    const shiftsSoFar: Record<string, number> = {};
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = ymd(addDays(nextMonday, i));
      const hours = footfallByStoreDate.get(`${s.code}_${ymd(addDays(today, i - 6))}`) ?? footfallHours(i);
      const shifts = suggestDayRoster(empsForStore, SHIFTS, hours, shiftsSoFar);
      return { date, shifts: shifts.map((sh) => ({ shiftId: sh.shiftId, employeeIds: sh.employeeIds })) };
    });
    rbatch.set(db.doc(`${P('rosters')}/${s.code}_${ymd(nextMonday)}`), { storeId: s.code, weekStart: ymd(nextMonday), days, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'seed' });
  }
  await rbatch.commit();

  return { footfallDays: 7 * stores.length, attendanceRows: an, candidates: CAND.length, leaveRequests: 13 };
}
