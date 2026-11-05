import { describe, expect, it } from 'vitest';
import { canMoveStage, checkGeofence, inclusiveDays, leaveBalance, requiredHeadcount, suggestDayRoster } from './hr';

describe('recruitment stages', () => {
  it('only allows moving one stage forward, or to rejected', () => {
    expect(canMoveStage('applied', 'screening')).toBe(true);
    expect(canMoveStage('applied', 'offer')).toBe(false);
    expect(canMoveStage('screening', 'rejected')).toBe(true);
    expect(canMoveStage('hired', 'applied')).toBe(false);
  });
});

describe('checkGeofence', () => {
  it('accepts a check-in inside the radius and rejects one outside it', () => {
    const store = { lat: 12.8905, lng: 77.5940 }; // Forum South, Bengaluru
    expect(checkGeofence(store.lat, store.lng, store.lat, store.lng, 150).ok).toBe(true);
    const far = checkGeofence(12.95, 77.60, store.lat, store.lng, 150);
    expect(far.ok).toBe(false);
    expect(far.distanceM).toBeGreaterThan(150);
  });
});

describe('leaveBalance', () => {
  it('subtracts taken and pending days from the annual quota', () => {
    expect(leaveBalance(12, 4, 2)).toMatchObject({ quota: 12, taken: 4, pending: 2, available: 6 });
    expect(leaveBalance(12, 10, 5).available).toBe(0); // never negative
  });
  it('unpaid leave (quota 0) is never capped', () => {
    expect(leaveBalance(0, 20, 0).available).toBe(Infinity);
  });
  it('inclusiveDays counts both endpoints', () => {
    expect(inclusiveDays('2026-11-10', '2026-11-12')).toBe(3);
    expect(inclusiveDays('2026-11-10', '2026-11-10')).toBe(1);
  });
});

describe('roster suggestion', () => {
  const shifts = [{ id: 'SH-MORN', startHour: 10, endHour: 18 }, { id: 'SH-EVE', startHour: 13, endHour: 22 }];
  it('headcount is ceil(avg footfall / 25), minimum 1', () => {
    const footfall = Array(24).fill(0).map((_, h) => (h >= 10 && h < 18 ? 100 : 0));
    expect(requiredHeadcount(footfall, shifts[0]!)).toBe(4); // 100/25 = 4
    expect(requiredHeadcount(Array(24).fill(1), shifts[0]!)).toBe(1); // ceil(1/25) floored to minimum 1
  });
  it('fills shifts round-robin without double-booking an employee the same day', () => {
    const employees = Array.from({ length: 6 }, (_, i) => ({ id: `E-${i}`, name: `Emp ${i}` }));
    const footfall = Array(24).fill(0).map((_, h) => (h >= 10 && h < 22 ? 50 : 0));
    const soFar: Record<string, number> = {};
    const result = suggestDayRoster(employees, shifts, footfall, soFar);
    const assigned = result.flatMap((r) => r.employeeIds);
    expect(new Set(assigned).size).toBe(assigned.length); // no one double-booked same day
    expect(result[0]!.requiredHeadcount).toBe(2); // 50/25
  });
});
