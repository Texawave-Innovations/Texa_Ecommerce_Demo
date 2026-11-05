import { z } from 'zod';

/** Phase 6 (Payroll) operational collections, read through the generic `scm` repo. */
export const PAYROLL_COLLECTIONS = ['payrollRuns', 'payslips'] as const;
export type PayrollCollection = (typeof PAYROLL_COLLECTIONS)[number];

export const RunPayrollInput = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM') });

export const PAYROLL_COMMAND_SCHEMAS = { runPayroll: RunPayrollInput } as const;
export type PayrollCommandName = keyof typeof PAYROLL_COMMAND_SCHEMAS;
