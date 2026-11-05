import Anthropic from '@anthropic-ai/sdk';
import { defineSecret } from 'firebase-functions/params';

export const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
export const CLAUDE_MODEL = 'claude-sonnet-5-5';

/** Returns null when no key is configured so callers can use a deterministic fallback. */
export function getClaude(): Anthropic | null {
  let key = '';
  try { key = ANTHROPIC_API_KEY.value(); } catch { /* not available */ }
  key ||= process.env.ANTHROPIC_API_KEY ?? '';
  return key ? new Anthropic({ apiKey: key }) : null;
}

export async function claudeText(system: string, user: string, maxTokens = 1024): Promise<string | null> {
  const c = getClaude();
  if (!c) return null;
  const res = await c.messages.create({
    model: CLAUDE_MODEL, max_tokens: maxTokens, system,
    messages: [{ role: 'user', content: user }],
  });
  return res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
}
