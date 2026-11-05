import { z } from 'zod';

export const ApprovalStatus = z.enum(['pending', 'approved', 'rejected']);
export const MasterChangeKind = z.enum(['create', 'update', 'deactivate', 'bulk']);

export const MasterChangeInput = z.object({
  master: z.string(),
  kind: z.enum(['create', 'update', 'deactivate']),
  id: z.string().min(1),
  data: z.record(z.string(), z.any()),
  note: z.string().nullish(),
});
export type MasterChangeInput = z.infer<typeof MasterChangeInput>;

export const BulkImportInput = z.object({
  master: z.string(),
  rows: z.array(z.record(z.string(), z.any())).min(1).max(200),
  note: z.string().nullish(),
});
export type BulkImportInput = z.infer<typeof BulkImportInput>;

export interface Approval {
  id: string;
  type: 'master';
  master: string;
  kind: z.infer<typeof MasterChangeKind>;
  docId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  rows?: Record<string, unknown>[];
  note?: string;
  status: z.infer<typeof ApprovalStatus>;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
}

export interface MasterVersion {
  id: string;
  version: number;
  data: Record<string, unknown>;
  changedBy: string;
  changedAt: string;
  kind: string;
}

export interface MasterDoc extends Record<string, unknown> {
  id: string;
  status: 'active' | 'inactive';
  version: number;
  updatedAt?: string;
  updatedBy?: string;
}

export interface DuplicateCandidate { a: string; b: string; score: number; reason: string }

export interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  userId: string;
  userName: string;
  role: string;
  at: string;
}
