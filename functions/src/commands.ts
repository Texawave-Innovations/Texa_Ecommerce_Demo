import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { z } from 'zod';
import { REGION, parseInput, requireCaller, type Caller } from './admin';
import { ANTHROPIC_API_KEY } from './claude';

export type Handler<S extends z.ZodType> = (c: Caller, input: z.output<S>) => Promise<unknown>;

/** Builds a callable from a zod schema + handler. Handlers are plain async functions so seed scripts and tests can call them directly. */
export function callable<S extends z.ZodType>(schema: S, handler: Handler<S>, opts: { claude?: boolean; timeoutSeconds?: number } = {}) {
  return onCall({ region: REGION, cors: true, timeoutSeconds: opts.timeoutSeconds ?? 60, ...(opts.claude ? { secrets: [ANTHROPIC_API_KEY] } : {}) }, async (req) => {
    const caller = requireCaller(req);
    const input = parseInput(schema, req.data);
    try { return await handler(caller, input); }
    catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('command failed', e);
      throw new HttpsError('internal', (e as Error).message ?? 'Internal error');
    }
  });
}
