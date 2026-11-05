import { z } from 'zod';

/** Reconciliation Centre collections (Phase 5). `reconFeeds` is the seeded source/target rows per type (CSV import);
 * `reconRuns` is one doc per run with the match-rate summary; `reconItems` holds every matched/unmatched/suggested pair. */
export const RECON_COLLECTIONS = ['reconFeeds', 'reconRuns', 'reconItems'] as const;
export type ReconCollection = (typeof RECON_COLLECTIONS)[number];

export const RECON_TYPE_KEYS = ['bank', 'upi', 'card', 'gateway', 'cod', 'cash', 'inventory_gl', 'gst_2b', 'erp_tally'] as const;
export const ReconType = z.enum(RECON_TYPE_KEYS);
export type ReconType = z.infer<typeof ReconType>;

export const RECON_ITEM_STATUSES = ['matched', 'unmatched_source', 'unmatched_target', 'ai_suggested', 'accepted', 'rejected'] as const;
export type ReconItemStatus = (typeof RECON_ITEM_STATUSES)[number];

export const RunReconInput = z.object({ type: ReconType });
export const DecideReconMatchInput = z.object({ itemId: z.string(), decision: z.enum(['accept', 'reject']) });
export const ReconAiSuggestInput = z.object({ type: ReconType });

export const RECON_COMMAND_SCHEMAS = {
  runRecon: RunReconInput, decideReconMatch: DecideReconMatchInput, reconAiSuggest: ReconAiSuggestInput,
} as const;
export type ReconCommandName = keyof typeof RECON_COMMAND_SCHEMAS;
