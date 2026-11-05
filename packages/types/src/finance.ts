import { z } from 'zod';

/** Phase 5 collections, read through the generic `scm` repo (journals/budgets are server-written only). */
export const FINANCE_COLLECTIONS = ['journals', 'budgets'] as const;
export type FinanceCollection = (typeof FINANCE_COLLECTIONS)[number];

const period = z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM');

export const ApAgeingReportInput = z.object({});
export const ArAgeingReportInput = z.object({});
export const StorePnlReportInput = z.object({ period: period.nullish() });
export const BudgetVsActualReportInput = z.object({ period: period.nullish() });
export const SetBudgetInput = z.object({ storeId: z.string(), period, salesBudgetPaise: z.number().int().nonnegative() });

export const FINANCE_COMMAND_SCHEMAS = {
  apAgeingReport: ApAgeingReportInput, arAgeingReport: ArAgeingReportInput, storePnlReport: StorePnlReportInput,
  budgetVsActualReport: BudgetVsActualReportInput, setBudget: SetBudgetInput,
} as const;
export type FinanceCommandName = keyof typeof FINANCE_COMMAND_SCHEMAS;
