import { z } from 'zod';

/** Phase 5 GST collections. `gst2bRecords` holds the seeded mock GSTR-2B feed (as if downloaded from the GST portal). */
export const GST_COLLECTIONS = ['gst2bRecords'] as const;
export type GstCollection = (typeof GST_COLLECTIONS)[number];

const period = z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM');
export const Gstr1ReportInput = z.object({ period: period.nullish() });
export const Gstr3bReportInput = z.object({ period: period.nullish() });
export const Gstr2bMismatchReportInput = z.object({ period: period.nullish() });

export const GST_COMMAND_SCHEMAS = {
  gstr1Report: Gstr1ReportInput, gstr3bReport: Gstr3bReportInput, gstr2bMismatchReport: Gstr2bMismatchReportInput,
} as const;
export type GstCommandName = keyof typeof GST_COMMAND_SCHEMAS;
