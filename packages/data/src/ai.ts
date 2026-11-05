import type { Briefing, InboxActionInput, InboxItem, UniChat, UniEvent, UniTurn } from '@texafashions/types';
import type { Unsubscribe } from './interfaces';

/** Uni assistant access: streaming chat (NDJSON events) + saved chats. Maps to `POST /v1/ai/chat` (SSE) on the NestJS API later. */
export interface AiRepo {
  /** Streams events for the conversation; resolves when the stream ends. `history` is plain text turns. */
  chat(history: Pick<UniTurn, 'role' | 'text'>[], chatId: string | null, onEvent: (e: UniEvent) => void, signal?: AbortSignal): Promise<void>;
  listChats(): Promise<UniChat[]>;
  /** Live inbox for the signed-in user (alerts + insights fanned out by the scheduled rules run). */
  subscribeInbox(cb: (items: InboxItem[]) => void): Unsubscribe;
  /** Assign / snooze / resolve / reopen / mark read. Server re-checks ownership and writes the audit log. */
  inboxAction(input: InboxActionInput): Promise<void>;
  /** Demo "Run now": evaluates every alert rule immediately (same code as the scheduler). */
  runAlertsNow(): Promise<{ evaluated: number; created: number }>;
  /** One Claude call summarising today's top 5 insights; cached per day server-side. */
  dailyBriefing(): Promise<Briefing>;
}
