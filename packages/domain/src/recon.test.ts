import { describe, expect, it } from 'vitest';
import { match, RECON_TYPES, reconTypeConfig, type ReconRow } from './recon';

const row = (id: string, amountPaise: number, date: string, refNo?: string): ReconRow => ({ id, amountPaise, date, refNo: refNo ?? null });

describe('recon — exact_ref_amount', () => {
  it('matches same ref + same amount', () => {
    const r = match([row('s1', 10000, '2026-01-01', 'TXN1')], [row('t1', 10000, '2026-01-01', 'TXN1')], [{ type: 'exact_ref_amount' }]);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ sourceIds: ['s1'], targetIds: ['t1'], confidence: 1 });
    expect(r.unmatchedSource).toHaveLength(0);
    expect(r.matchRatePct).toBe(100);
  });
  it('leaves mismatched amounts unmatched even with the same ref', () => {
    const r = match([row('s1', 10000, '2026-01-01', 'TXN1')], [row('t1', 9000, '2026-01-01', 'TXN1')], [{ type: 'exact_ref_amount' }]);
    expect(r.matches).toHaveLength(0);
    expect(r.unmatchedSource).toHaveLength(1);
    expect(r.unmatchedTarget).toHaveLength(1);
  });
});

describe('recon — amount_date_window', () => {
  it('matches equal amounts within the date window, picking the closest date', () => {
    const r = match(
      [row('s1', 5000, '2026-01-05')],
      [row('t-far', 5000, '2026-01-02'), row('t-near', 5000, '2026-01-06')],
      [{ type: 'amount_date_window', dateWindowDays: 5 }],
    );
    expect(r.matches[0]?.targetIds).toEqual(['t-near']);
  });
  it('rejects a match outside the window', () => {
    const r = match([row('s1', 5000, '2026-01-01')], [row('t1', 5000, '2026-01-10')], [{ type: 'amount_date_window', dateWindowDays: 2 }]);
    expect(r.matches).toHaveLength(0);
  });
});

describe('recon — many_to_one', () => {
  it('matches several source rows summing to one target row', () => {
    const r = match(
      [row('s1', 3000, '2026-01-01'), row('s2', 4000, '2026-01-01'), row('s3', 1000, '2026-01-01')],
      [row('t1', 7000, '2026-01-01')],
      [{ type: 'many_to_one', dateWindowDays: 1 }],
    );
    expect(r.matches).toHaveLength(1);
    expect(new Set(r.matches[0]!.sourceIds)).toEqual(new Set(['s1', 's2']));
    expect(r.unmatchedSource.map((x) => x.id)).toEqual(['s3']);
  });
  it('matches one source row to several target rows summing to it (reverse direction)', () => {
    const r = match(
      [row('s1', 7000, '2026-01-01')],
      [row('t1', 3000, '2026-01-01'), row('t2', 4000, '2026-01-01'), row('t3', 1000, '2026-01-01')],
      [{ type: 'many_to_one', dateWindowDays: 1 }],
    );
    expect(r.matches).toHaveLength(1);
    expect(new Set(r.matches[0]!.targetIds)).toEqual(new Set(['t1', 't2']));
    expect(r.unmatchedTarget.map((x) => x.id)).toEqual(['t3']);
  });
});

describe('recon — rule chaining', () => {
  it('falls through to a second rule for whatever the first rule leaves unmatched', () => {
    const r = match(
      [row('s1', 1000, '2026-01-01', 'A'), row('s2', 2000, '2026-01-02')],
      [row('t1', 1000, '2026-01-01', 'A'), row('t2', 2000, '2026-01-03')],
      [{ type: 'exact_ref_amount' }, { type: 'amount_date_window', dateWindowDays: 2 }],
    );
    expect(r.matches).toHaveLength(2);
    expect(r.matches.map((m) => m.rule)).toEqual(['exact_ref_amount', 'amount_date_window']);
  });
});

describe('RECON_TYPES', () => {
  it('has 9 configured recon types', () => expect(RECON_TYPES).toHaveLength(9));
  it('reconTypeConfig falls back to the first type for an unknown key', () => expect(reconTypeConfig('nope').key).toBe(RECON_TYPES[0]!.key));
});
