import { z } from 'zod';

/** Phase 5 Tally-sync collections. `tallyQueue` holds one envelope per posted journal; `tallySyncLog` is the
 * append-only history of every attempt `apps/tally-agent` makes against it. */
export const TALLY_COLLECTIONS = ['tallyQueue', 'tallySyncLog'] as const;
export type TallyCollection = (typeof TALLY_COLLECTIONS)[number];
export const TALLY_SYNC_STATUSES = ['queued', 'sent', 'failed'] as const;
export type TallySyncStatus = (typeof TALLY_SYNC_STATUSES)[number];

export const ExportTallyXmlInput = z.object({ storeId: z.string(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), voucherType: z.enum(['Sales', 'Purchase', 'Payment', 'Receipt', 'Credit Note', 'Debit Note', 'Journal']).nullish() });
export const RetryTallySyncInput = z.object({ queueId: z.string() });

export const TALLY_COMMAND_SCHEMAS = { exportTallyXml: ExportTallyXmlInput, retryTallySync: RetryTallySyncInput } as const;
export type TallyCommandName = keyof typeof TALLY_COMMAND_SCHEMAS;
