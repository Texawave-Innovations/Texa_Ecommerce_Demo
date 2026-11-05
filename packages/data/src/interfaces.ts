/**
 * Repository interfaces — the ONLY surface the UI may use to reach data.
 * Implemented today by FirebaseAdapter; later by RestAdapter (NestJS + Postgres).
 */
import type {
  Approval, AuditLog, BulkImportInput, Claims, DemoControlInput, DemoControlResult, DuplicateCandidate, MasterChangeInput, MasterDoc, MasterVersion, Role,
} from '@texafashions/types';

export interface Session { uid: string; email: string; name: string; claims: Claims }
export type Unsubscribe = () => void;

export interface AuthRepo {
  /** Emits null when signed out; emits once on startup after restoring persisted session. */
  onSession(cb: (s: Session | null) => void): Unsubscribe;
  /** Demo role switcher (emulator / demo deployments only). */
  demoSignIn(role: Role): Promise<void>;
  signInWithPassword(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

export interface ListMastersOptions { keyword?: string; includeInactive?: boolean; limit?: number }

export interface MasterRepo {
  list(master: string, opts?: ListMastersOptions): Promise<MasterDoc[]>;
  /** Live updates (snapshot-driven) for list screens. */
  subscribe(master: string, cb: (docs: MasterDoc[]) => void, opts?: ListMastersOptions): Unsubscribe;
  get(master: string, id: string): Promise<MasterDoc | null>;
  history(master: string, id: string): Promise<MasterVersion[]>;
  /** Creates a pending approval (maker step). Returns the approval id. */
  submitChange(input: MasterChangeInput): Promise<{ approvalId: string }>;
  importRows(input: BulkImportInput): Promise<{ approvalId: string; rows: number }>;
  listApprovals(status?: 'pending' | 'approved' | 'rejected'): Promise<Approval[]>;
  subscribePendingCount(cb: (n: number) => void): Unsubscribe;
  /** Checker step. */
  decide(approvalId: string, approve: boolean, note?: string): Promise<void>;
  detectDuplicates(master: string): Promise<{ usedClaude: boolean; candidates: DuplicateCandidate[] }>;
  uploadImage(master: string, id: string, file: Blob, fileName: string): Promise<string>;
}

export interface AdminUser { uid: string; email: string; displayName: string; claims: Claims | null; disabled: boolean }
export interface AdminRepo {
  listUsers(): Promise<AdminUser[]>;
  setClaims(uid: string, claims: Claims): Promise<void>;
  listAuditLogs(opts?: { entity?: string; limit?: number }): Promise<AuditLog[]>;
  /** Super Admin demo controls: busy hour (POS burst + Store Twin crowd), 5 web orders, critical alert. */
  demoControl(action: DemoControlInput['action']): Promise<DemoControlResult>;
}

import type { ScmRepo } from './scm';
import type { PosRepo } from './pos';
import type { AiRepo } from './ai';
import type { TwinRepo } from './twin';
export interface DataContext { auth: AuthRepo; masters: MasterRepo; admin: AdminRepo; scm: ScmRepo; pos: PosRepo; ai: AiRepo; twin: TwinRepo }
