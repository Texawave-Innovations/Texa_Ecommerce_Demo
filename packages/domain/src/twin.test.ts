import { describe, expect, it } from 'vitest';
import { newSim, snapshot, stepSim, targetPopulation, queueStats, staffSuggestion, conversionPct, accumulateDwell, heatLevel, warmStart, type TwinPerson, type TwinZone } from './twin';

const defs: [string, number[][]][] = [['Entrance', [[10, 200], [120, 250]]], ['Plushies', [[10, 10], [140, 100]]], ['Bags', [[150, 10], [260, 100]]], ['Cash Wrap', [[270, 200], [390, 250]]]];
const zones: TwinZone[] = ['F1', 'F2'].flatMap((f) => defs.map(([n, p]) => ({ id: `${f}-${n}`, floorId: f, name: n, polygon: p.map(([x, y]) => ({ x: x!, y: y! })) })));
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

describe('twin simulator', () => {
  it('keeps total population within 15–60 across the day', () => {
    for (let h = 0; h < 24; h++) { const t = targetPopulation(h); expect(t).toBeGreaterThanOrEqual(15); expect(t).toBeLessThanOrEqual(60); }
    expect(targetPopulation(19.5)).toBeGreaterThan(targetPopulation(11));
  });

  it('runs 10 minutes: people stay on the floor plate, entries/bills grow, queue forms', () => {
    const s = newSim(); const rand = lcg(7); let maxQ = 0;
    for (let t = 0; t < 600; t++) {
      stepSim(s, { zones, floors: ['F1', 'F2'], hour: 19, rand, dt: 1 });
      for (const p of s.people) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(400); expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(260); }
      maxQ = Math.max(maxQ, queueStats(snapshot(s, 'F1')).length);
    }
    expect(s.entries).toBeGreaterThan(50);
    expect(s.bills).toBeGreaterThan(5);
    expect(s.people.length).toBeLessThanOrEqual(70);
    expect(snapshot(s, 'F1').length + snapshot(s, 'F2').length).toBe(s.people.length);
    expect(maxQ).toBeGreaterThan(0);
  });

  it('has staff on the home floor, one at the till', () => {
    const s = newSim(); const rand = lcg(3);
    for (let t = 0; t < 30; t++) stepSim(s, { zones, floors: ['F1', 'F2'], hour: 14, rand, dt: 1 });
    const staff = s.people.filter((p) => p.k === 's');
    expect(staff.length).toBeGreaterThanOrEqual(4);
    expect(staff.some((p) => p.zone === 'F1-Cash Wrap')).toBe(true);
  });
});

describe('twin metrics', () => {
  const P = (o: Partial<TwinPerson>): TwinPerson => ({ id: Math.random().toString(), k: 'c', x: 0, y: 0, z: 'F1-Bags', a: 'browse', ...o });
  it('queue length and wait', () => {
    const q = queueStats([P({ a: 'queue' }), P({ a: 'queue' }), P({ a: 'pay' })]);
    expect(q.length).toBe(2); expect(q.waitSec).toBe(2 * 9 + 3);
  });
  it('suggestion priority: queue > uncovered zone > conversion > ok', () => {
    const q = Array.from({ length: 4 }, () => P({ a: 'queue', z: 'F1-Cash Wrap' }));
    expect(staffSuggestion(q, zones, null).tone).toBe('cherry');
    const crowd = Array.from({ length: 5 }, () => P({ z: 'F1-Bags' }));
    expect(staffSuggestion(crowd, zones, null).text).toContain('Bags');
    expect(staffSuggestion([P({})], zones, { entriesToday: 100, billsToday: 5 }).text).toContain('Conversion');
    expect(staffSuggestion([P({})], zones, { entriesToday: 100, billsToday: 30 }).tone).toBe('mint');
  });
  it('conversion, dwell heat, warm start', () => {
    expect(conversionPct({ entriesToday: 200, billsToday: 30 })).toBeCloseTo(15);
    expect(conversionPct(null)).toBe(0);
    const h = accumulateDwell({}, [P({ z: 'A' }), P({ z: 'A' }), P({ z: 'B' }), P({ z: 'C', a: 'walk' })]);
    expect(heatLevel(h, 'A')).toBe(1); expect(heatLevel(h, 'B')).toBe(0.5); expect(heatLevel(h, 'C')).toBe(0);
    expect(warmStart(9).entries).toBe(0); expect(warmStart(20).entries).toBeGreaterThan(300);
  });
});
