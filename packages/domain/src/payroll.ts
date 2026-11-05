/** Payroll — pure logic: gross from salary structure + attendance + overtime + commission, PF/ESI/PT/TDS deductions. */
import { percentOf, rupeesToPaise } from './money';

export interface SalaryStructure {
  basicPaise: number; hraPaise: number; specialAllowancePaise: number; commissionPct: number;
  pfApplicable: boolean; esiApplicable: boolean;
}
export interface PtSlab { upTo: number | null; tax: number }
export interface StatutorySetting { pfEmployeePct: number; pfEmployerPct: number; esiEmployeePct: number; esiEmployerPct: number; ptSlabs: PtSlab[] }

export const ESI_WAGE_CEILING_PAISE = rupeesToPaise(21_000);
/** Simplified (not the real multi-slab) annual exemption + flat rate, enough to exercise the TDS branch in the demo. */
export const TDS_ANNUAL_EXEMPTION_PAISE = rupeesToPaise(500_000);
export const SIMPLE_TDS_RATE_PCT = 5;
export const OVERTIME_MULTIPLIER = 1.5;
export const STANDARD_HOURS_PER_DAY = 8;

/** Monthly TDS (simplified): flat 5% of the annualised gross above a flat exemption, spread back over 12 months. */
export function monthlyTds(monthlyGrossPaise: number): number {
  const annualPaise = monthlyGrossPaise * 12;
  if (annualPaise <= TDS_ANNUAL_EXEMPTION_PAISE) return 0;
  return Math.round(((annualPaise - TDS_ANNUAL_EXEMPTION_PAISE) * SIMPLE_TDS_RATE_PCT) / 100 / 12);
}

/** First slab (ascending by `upTo`, `null` = no ceiling) whose ceiling covers the gross. */
export function ptForGross(slabs: PtSlab[], grossPaise: number): number {
  const sorted = [...slabs].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  const hit = sorted.find((s) => s.upTo === null || grossPaise <= s.upTo);
  return hit ? hit.tax : 0;
}

/** Overtime beyond the scheduled day, paid at `OVERTIME_MULTIPLIER`x the basic's derived hourly rate. */
export function monthlyOvertimePaise(fullBasicPaise: number, daysInMonth: number, overtimeHours: number, hoursPerDay = STANDARD_HOURS_PER_DAY): number {
  if (overtimeHours <= 0) return 0;
  const hourlyRate = fullBasicPaise / (daysInMonth * hoursPerDay);
  return Math.round(hourlyRate * OVERTIME_MULTIPLIER * overtimeHours);
}

export interface PayrollInputs {
  structure: SalaryStructure; statutory: StatutorySetting;
  daysInMonth: number; payableDays: number; overtimeHours: number; salesNetPaise: number;
}
export interface PayrollResult {
  basicPaise: number; hraPaise: number; specialAllowancePaise: number; overtimePaise: number; commissionPaise: number; grossPaise: number;
  pfEmployeePaise: number; pfEmployerPaise: number; esiEmployeePaise: number; esiEmployerPaise: number; ptPaise: number; tdsPaise: number;
  totalDeductionsPaise: number; netPaise: number;
}

/** Gross = pro-rated (basic + HRA + special allowance) + overtime + sales commission. Deductions reduce it to net pay. */
export function computePayroll(i: PayrollInputs): PayrollResult {
  const prorate = (p: number) => Math.round((p * i.payableDays) / i.daysInMonth);
  const basicPaise = prorate(i.structure.basicPaise);
  const hraPaise = prorate(i.structure.hraPaise);
  const specialAllowancePaise = prorate(i.structure.specialAllowancePaise);
  const overtimePaise = monthlyOvertimePaise(i.structure.basicPaise, i.daysInMonth, i.overtimeHours);
  const commissionPaise = Math.round((i.salesNetPaise * i.structure.commissionPct) / 100);
  const grossPaise = basicPaise + hraPaise + specialAllowancePaise + overtimePaise + commissionPaise;

  const pfEmployeePaise = i.structure.pfApplicable ? percentOf(basicPaise, i.statutory.pfEmployeePct) : 0;
  const pfEmployerPaise = i.structure.pfApplicable ? percentOf(basicPaise, i.statutory.pfEmployerPct) : 0;
  const esiEligible = i.structure.esiApplicable && grossPaise <= ESI_WAGE_CEILING_PAISE;
  const esiEmployeePaise = esiEligible ? percentOf(grossPaise, i.statutory.esiEmployeePct) : 0;
  const esiEmployerPaise = esiEligible ? percentOf(grossPaise, i.statutory.esiEmployerPct) : 0;
  const ptPaise = ptForGross(i.statutory.ptSlabs, grossPaise);
  const tdsPaise = monthlyTds(grossPaise);

  const totalDeductionsPaise = pfEmployeePaise + esiEmployeePaise + ptPaise + tdsPaise;
  const netPaise = grossPaise - totalDeductionsPaise;
  return { basicPaise, hraPaise, specialAllowancePaise, overtimePaise, commissionPaise, grossPaise, pfEmployeePaise, pfEmployerPaise, esiEmployeePaise, esiEmployerPaise, ptPaise, tdsPaise, totalDeductionsPaise, netPaise };
}
