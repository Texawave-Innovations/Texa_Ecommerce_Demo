import { z } from 'zod';

/** Uni assistant: tool-result cards rendered by the chat UI. `confirm` cards are proposals; the client runs `command` only after the user taps Confirm. */
export type UniCard =
  | { kind: 'table'; title: string; columns: string[]; rows: (string | number)[][]; source: { label: string; href: string } }
  | { kind: 'chart'; title: string; unit: 'paise' | 'count'; points: { label: string; value: number }[]; source: { label: string; href: string } }
  | { kind: 'confirm'; title: string; summary: string[]; command: 'createPR' | 'issueVouchers'; input: Record<string, unknown> }
  | { kind: 'note'; text: string };

export type UniEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; input: unknown }
  | { type: 'card'; card: UniCard }
  | { type: 'done'; chatId: string }
  | { type: 'error'; message: string };

export interface UniTurn { role: 'user' | 'assistant'; text: string; cards?: UniCard[] }
export interface UniChat { id: string; title: string; messages: UniTurn[]; updatedAt?: string }

// ───────── Notifications + insights (Phase 7)
export type InboxSeverity = 'critical' | 'warning' | 'info';
export type InboxStatus = 'new' | 'read' | 'snoozed' | 'resolved';
/** One row in a user's inbox (`/inbox/{uid}_{insightId}`); denormalised from `/aiInsights/{insightId}` so the drawer reads a single collection. */
export interface InboxItem {
  id: string; userId: string; insightId: string; ruleId: string; severity: InboxSeverity; status: InboxStatus;
  title: string; detail: string; storeId: string | null; link?: string | null; suggestion?: { kind: 'replenish' | 'markdown'; qty?: number; markdownPct?: number } | null;
  assignedTo?: string | null; assignedToName?: string | null; assignedBy?: string | null; snoozedUntil?: string | null; createdAt?: string; updatedAt?: string;
}
export interface Briefing { day: string; text: string; source: 'claude' | 'rules'; top: { title: string; severity: InboxSeverity; storeId: string | null }[]; cached: boolean }

export const InboxActionInput = z.object({
  id: z.string().min(1),
  action: z.enum(['read', 'assign', 'snooze', 'resolve', 'reopen']),
  assignTo: z.string().nullish(),
  snoozeHours: z.number().int().min(1).max(72).nullish(),
});
export type InboxActionInput = z.infer<typeof InboxActionInput>;
export const RunAlertsInput = z.object({});
