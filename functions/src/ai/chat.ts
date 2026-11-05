import type Anthropic from '@anthropic-ai/sdk';
import { onRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { z } from 'zod';
import { ClaimsSchema, type UniCard } from '@texafashions/types';
import { FieldValue, REGION, col, type Caller } from '../admin';
import { ANTHROPIC_API_KEY, CLAUDE_MODEL, getClaude } from '../claude';
import { ymd } from '../engine';
import { TOOL_DEFS, runTool, systemPrompt } from './uni';

const Body = z.object({
  chatId: z.string().nullish(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).min(1).max(30),
});

type Send = (e: Record<string, unknown>) => void;
interface Turn { role: 'user' | 'assistant'; text: string; cards?: UniCard[] }

const addDays = (d: string, n: number) => ymd(new Date(new Date(`${d}T00:00:00+05:30`).getTime() + n * 86_400_000));

/** No API key → keyword router over the same tools, so the demo still answers. */
async function fallback(c: Caller, text: string, send: Send): Promise<Turn> {
  const q = text.toLowerCase(); const today = ymd(); const store = /\b(st-[a-z0-9-]+|[a-z]{2,4}-[a-z]{2,4})\b/i.exec(text)?.[0]?.toUpperCase();
  const own = c.claims.storeIds[0];
  let name = 'getSales'; let input: Record<string, unknown> = { from: addDays(today, -6), to: today, storeId: store ?? null };
  if (/low|running out|reorder/.test(q)) { name = 'getLowStock'; input = { storeId: store ?? own ?? 'WH-CENTRAL' }; }
  else if (/stock|inventory/.test(q)) { name = 'getStock'; input = { storeId: store ?? own ?? 'WH-CENTRAL' }; }
  else if (/\bpo\b|purchase order/.test(q)) { name = 'getOpenPOs'; input = {}; }
  else if (/variance|cash/.test(q)) { name = 'getCashVariance'; input = { date: /yesterday/.test(q) ? addDays(today, -1) : today }; }
  else if (/p&l|pnl|profit|margin/.test(q)) { name = 'getPnL'; input = { month: today.slice(0, 7), storeId: store ?? null }; }
  else if (/voucher/.test(q)) { name = 'createVoucher'; input = { seriesId: 'VS-WELCOME', count: Number(/\d+/.exec(q)?.[0] ?? 10) }; }
  else if (/requisition|\bpr\b|reorder|restock/.test(q)) { name = 'createPurchaseRequisition'; input = { storeId: store ?? own ?? 'WH-CENTRAL', lines: [{ sku: 'a', qty: 10 }] }; }
  send({ type: 'tool', name, input });
  const r = await runTool(c, name, input);
  send({ type: 'card', card: r.card });
  const reply = r.card.kind === 'confirm' ? 'Here’s what I’d do — please review and tap Confirm. (Offline mode: add an Anthropic key for full conversations.)' : r.card.kind === 'note' ? r.card.text : 'Here’s what I found. (Offline mode: add an Anthropic key for full conversations.)';
  send({ type: 'text', delta: reply });
  return { role: 'assistant', text: reply, cards: [r.card] };
}

async function withClaude(client: Anthropic, c: Caller, history: Anthropic.MessageParam[], send: Send): Promise<Turn> {
  const msgs = [...history]; const cards: UniCard[] = []; let text = '';
  for (let step = 0; step < 5; step++) {
    const stream = client.messages.stream({ model: CLAUDE_MODEL, max_tokens: 1024, system: systemPrompt(c, ymd()), tools: TOOL_DEFS, messages: msgs });
    stream.on('text', (delta) => { text += delta; send({ type: 'text', delta }); });
    const final = await stream.finalMessage();
    const uses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (final.stop_reason !== 'tool_use' || !uses.length) break;
    msgs.push({ role: 'assistant', content: final.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      send({ type: 'tool', name: u.name, input: u.input });
      const r = await runTool(c, u.name, u.input);
      cards.push(r.card); send({ type: 'card', card: r.card });
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(r.forModel).slice(0, 12_000) });
    }
    msgs.push({ role: 'user', content: results });
  }
  return { role: 'assistant', text, cards };
}

/** Appends the new user turn + reply to the stored chat (keeps earlier tool cards, which the client doesn't resend). */
async function saveChat(c: Caller, chatId: string | null | undefined, question: Turn, reply: Turn): Promise<string> {
  const ref = chatId ? col('aiChats').doc(chatId) : col('aiChats').doc();
  const existing = chatId ? await ref.get() : null;
  if (existing?.exists && existing.get('userId') !== c.uid) throw new Error('Not your chat');
  const before = (existing?.exists ? existing.get('messages') : []) as Turn[];
  const title = (existing?.exists ? existing.get('title') : null) ?? question.text.slice(0, 60);
  await ref.set({ userId: c.uid, userName: c.name, title, messages: [...before, question, reply], updatedAt: FieldValue.serverTimestamp(), ...(existing?.exists ? {} : { createdAt: FieldValue.serverTimestamp() }) }, { merge: true });
  return ref.id;
}

/**
 * Streaming chat endpoint: POST {messages, chatId?} with `Authorization: Bearer <ID token>` → newline-delimited JSON events
 * (`text` | `tool` | `card` | `done` | `error`). Claims come from the verified token and are re-checked inside every tool.
 */
export const aiChat = onRequest({ region: REGION, cors: true, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: '512MiB' }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  let caller: Caller;
  try {
    const tok = await getAuth().verifyIdToken((req.get('authorization') ?? '').replace(/^Bearer /i, ''));
    const claims = ClaimsSchema.parse(tok);
    caller = { uid: tok.uid, name: (tok.name as string | undefined) ?? tok.uid, claims };
  } catch { res.status(401).send('Sign in required'); return; }
  const body = Body.safeParse(req.body);
  if (!body.success) { res.status(400).send(body.error.issues.map((i) => i.message).join('; ')); return; }

  res.setHeader('Content-Type', 'application/x-ndjson'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('X-Accel-Buffering', 'no');
  const send: Send = (e) => { res.write(`${JSON.stringify(e)}\n`); };
  try {
    const prior: Turn[] = body.data.messages.map((m) => ({ role: m.role, text: m.content }));
    const last = prior[prior.length - 1]!;
    const client = getClaude();
    const reply = client
      ? await withClaude(client, caller, body.data.messages.map((m) => ({ role: m.role, content: m.content })), send)
      : await fallback(caller, last.text, send);
    send({ type: 'done', chatId: await saveChat(caller, body.data.chatId, last, reply) });
  } catch (e) {
    console.error('aiChat failed', e);
    send({ type: 'error', message: 'Uni hit a snag — please try again.' });
  }
  res.end();
});
