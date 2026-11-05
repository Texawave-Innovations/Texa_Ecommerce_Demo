import { describe, expect, it } from 'vitest';
import { financialYear, formatDocNumber, formatINR, percentOf, findDuplicateCandidates, similarity, makeGstin, isValidGstin } from './index';

describe('number series', () => {
  it('formats like PO/BLR-FS/26-27/00001', () => {
    expect(formatDocNumber({ docType: 'PO', storeCode: 'BLR-FS', fy: '26-27' }, 1)).toBe('PO/BLR-FS/26-27/00001');
  });
  it('rolls financial year on 1 April IST', () => {
    expect(financialYear(new Date('2026-03-31T10:00:00Z'))).toBe('25-26');
    expect(financialYear(new Date('2026-04-01T10:00:00Z'))).toBe('26-27');
    expect(financialYear(new Date('2026-03-31T19:00:00Z'))).toBe('26-27'); // 00:30 IST Apr 1
  });
});
describe('money', () => {
  it('formats INR with Indian grouping', () => {
    expect(formatINR(123456700)).toBe('₹12,34,567');
    expect(formatINR(19900)).toBe('₹199');
  });
  it('percentOf rounds to paise', () => { expect(percentOf(199900, 5)).toBe(9995); });
});
describe('similarity', () => {
  it('flags near-duplicates only', () => {
    expect(similarity('Capybara Plush Large Brown', 'Capybara Plush Large Browm')).toBeGreaterThan(0.8);
    const d = findDuplicateCandidates([
      { id: '1', name: 'Capybara Plush Large Brown' }, { id: '2', name: 'Capybara Plush Large Browm' }, { id: '3', name: 'Bunny Tote Bag Pink' },
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ a: '1', b: '2' });
  });
});
describe('duplicate variants', () => {
  it('does not flag colour variants but flags true duplicates', () => {
    const d = findDuplicateCandidates([
      { id: 'a', name: 'Canvas tote — Pink', variant: 'Pink' }, { id: 'b', name: 'Canvas tote — Mint', variant: 'Mint' }, { id: 'c', name: 'Canvas tote — Pink ', variant: 'Pink' },
    ], 0.8);
    expect(d.map((x) => [x.a, x.b])).toEqual([['a', 'c']]);
  });
});
describe('gstin', () => {
  it('generates valid checksums', () => {
    const g = makeGstin('29', 'AABCU1234F');
    expect(isValidGstin(g)).toBe(true);
    expect(isValidGstin(g.slice(0, 14) + (g[14] === 'A' ? 'B' : 'A'))).toBe(false);
  });
});
