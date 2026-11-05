import { z } from 'zod';

/** Super Admin demo controls (`demoControl` callable). `reset` and POS offline live outside it: see /admin/demo. */
export const DEMO_ACTIONS = ['busy_hour', 'web_orders', 'critical_alert'] as const;
export const DemoControlInput = z.object({ action: z.enum(DEMO_ACTIONS) });
export type DemoControlInput = z.infer<typeof DemoControlInput>;
export interface DemoControlResult { message: string }
