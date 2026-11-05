import { describe, expect, it } from 'vitest';
import { computePayroll, monthlyOvertimePaise, monthlyTds, ptForGross, TDS_ANNUAL_EXEMPTION_PAISE, type StatutorySetting } from './payroll';

// Mirrors the seeded /orgs/texafashions/statutorySettings docs (ptSlabs are in paise: MH is nil/7,500, 175/10,000, 200 above).
const MH: StatutorySetting = { pfEmployeePct: 12, pfEmployerPct: 12, esiEmployeePct: 0.75, esiEmployerPct: 3.25, ptSlabs: [{ upTo: 750_000, tax: 0 }, { upTo: 1_000_000, tax: 17_500 }, { upTo: null, tax: 20_000 }] };
const KA: StatutorySetting = { pfEmployeePct: 12, pfEmployerPct: 12, esiEmployeePct: 0.75, esiEmployerPct: 3.25, ptSlabs: [{ upTo: 2_500_000, tax: 0 }, { upTo: null, tax: 20_000 }] };

describe('computePayroll', () => {
  it('store manager: full month, no ESI (not applicable on the structure), PT on the top MH slab', () => {
    const r = computePayroll({
      structure: { basicPaise: 22_00000, hraPaise: 8_80000, specialAllowancePaise: 6_00000, commissionPct: 0.5, pfApplicable: true, esiApplicable: false },
      statutory: MH, daysInMonth: 30, payableDays: 30, overtimeHours: 0, salesNetPaise: 10_00000,
    });
    expect(r.basicPaise).toBe(22_00000);
    expect(r.commissionPaise).toBe(5000); // 0.5% of ₹10,000 sales
    expect(r.grossPaise).toBe(36_85000);
    expect(r.pfEmployeePaise).toBe(2_64000); // 12% of basic
    expect(r.esiEmployeePaise).toBe(0); // esiApplicable is false on this structure
    expect(r.ptPaise).toBe(20_000); // gross > ₹10,000 → top MH slab
    expect(r.tdsPaise).toBe(0); // annualised gross well under the exemption
    expect(r.netPaise).toBe(r.grossPaise - r.pfEmployeePaise - r.ptPaise);
  });

  it('sales associate: 2 unpaid days + overtime + commission, ESI applies under the wage ceiling', () => {
    const r = computePayroll({
      structure: { basicPaise: 10_00000, hraPaise: 4_00000, specialAllowancePaise: 1_50000, commissionPct: 1, pfApplicable: true, esiApplicable: true },
      statutory: MH, daysInMonth: 30, payableDays: 28, overtimeHours: 4, salesNetPaise: 2_00000,
    });
    expect(r.basicPaise).toBe(9_33333); // prorated 28/30
    expect(r.overtimePaise).toBe(25000); // 4h at 1.5x the full-basic hourly rate
    expect(r.commissionPaise).toBe(2000); // 1% of ₹2,000 sales
    expect(r.grossPaise).toBe(14_73666);
    expect(r.pfEmployeePaise).toBe(1_12000); // 12% of prorated basic
    expect(r.esiEmployeePaise).toBe(11052); // gross under ₹21,000 ceiling → 0.75%
    expect(r.ptPaise).toBe(20_000);
    expect(r.tdsPaise).toBe(0);
    expect(r.netPaise).toBe(r.grossPaise - r.totalDeductionsPaise);
  });

  it('senior head-office employee (Karnataka): gross high enough to cross into TDS', () => {
    const r = computePayroll({
      structure: { basicPaise: 50_00000, hraPaise: 20_00000, specialAllowancePaise: 10_00000, commissionPct: 0, pfApplicable: true, esiApplicable: false },
      statutory: KA, daysInMonth: 31, payableDays: 31, overtimeHours: 0, salesNetPaise: 0,
    });
    expect(r.grossPaise).toBe(80_00000);
    expect(r.pfEmployeePaise).toBe(6_00000);
    expect(r.esiEmployeePaise).toBe(0);
    expect(r.ptPaise).toBe(20_000); // gross above the KA ₹25,000 ceiling
    expect(r.tdsPaise).toBe(191667); // 5% of (₹9,60,000 − ₹5,00,000) / 12
    expect(r.netPaise).toBe(r.grossPaise - r.totalDeductionsPaise);
  });
});

describe('ptForGross', () => {
  it('picks the first slab whose ceiling covers the gross, regardless of input order', () => {
    const slabs = [{ upTo: null, tax: 20_000 }, { upTo: 1_000_000, tax: 17_500 }, { upTo: 750_000, tax: 0 }];
    expect(ptForGross(slabs, 500_000)).toBe(0);
    expect(ptForGross(slabs, 900_000)).toBe(17_500);
    expect(ptForGross(slabs, 5_000_000)).toBe(20_000);
  });
});

describe('monthlyOvertimePaise', () => {
  it('is zero for zero or negative hours', () => {
    expect(monthlyOvertimePaise(10_00000, 30, 0)).toBe(0);
    expect(monthlyOvertimePaise(10_00000, 30, -2)).toBe(0);
  });
});

describe('monthlyTds', () => {
  it('is zero at or under the annual exemption threshold', () => {
    expect(monthlyTds(Math.floor(TDS_ANNUAL_EXEMPTION_PAISE / 12))).toBe(0);
  });
  it('is 5% of the excess above exemption, spread over 12 months', () => {
    const monthlyGross = 60_00000; // ₹60,000/mo → ₹7,20,000/yr, above the ₹5,00,000 exemption
    expect(monthlyTds(monthlyGross)).toBe(Math.round(((monthlyGross * 12 - TDS_ANNUAL_EXEMPTION_PAISE) * 5) / 100 / 12));
  });
});
