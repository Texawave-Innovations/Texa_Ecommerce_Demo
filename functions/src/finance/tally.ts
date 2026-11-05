/** Tally-sync callables: on-demand per-store-per-day XML export, and retrying a failed `tallyQueue` item.
 * The queue itself is populated by the `enqueueTallySync` trigger in triggers.ts as each journal posts. */
import type { z } from 'zod';
import { buildTallyEnvelope, buildTallyVoucher, TALLY_VOUCHER_FOR_EVENT } from '@texafashions/domain';
import type { ExportTallyXmlInput, RetryTallySyncInput } from '@texafashions/types';
import { col, FieldValue, type Caller } from '../admin';
import { requireRoles } from '../engine';

type Doc = Record<string, any>;
const COMPANY_NAME = 'Texa Fashions';

/** Ledger master id → exact TallyPrime ledger name, as seeded on each ledger's `tallyName` field (falls back to the id). */
async function ledgerNameMap(): Promise<Record<string, string>> {
  const snap = await col('ledgers').get();
  return Object.fromEntries(snap.docs.map((d) => [d.id, (d.get('tallyName') as string | undefined) ?? d.id]));
}

/** Aggregates every journal for a store+day (optionally filtered to one voucher type) into a single multi-voucher envelope. */
export async function exportTallyXml(c: Caller, i: z.output<typeof ExportTallyXmlInput>) {
  requireRoles(c, 'cfo', 'super_admin', 'auditor');
  const [journals, ledgerNames] = await Promise.all([col('journals').where('storeId', '==', i.storeId).where('day', '==', i.day).get(), ledgerNameMap()]);
  const vouchers = journals.docs
    .map((d) => { const j = d.data() as Doc; const voucherType = TALLY_VOUCHER_FOR_EVENT[j.event] ?? 'Journal'; return { d, j, voucherType }; })
    .filter((r) => !i.voucherType || r.voucherType === i.voucherType)
    .map(({ d, j, voucherType }) => buildTallyVoucher({ voucherType, date: i.day, voucherNumber: j.refId ?? d.id, narration: `${j.event} — ${j.refType} ${j.refId}`, lines: j.lines, ledgerNames }));
  if (!vouchers.length) return { xml: null, count: 0 };
  return { xml: buildTallyEnvelope(COMPANY_NAME, vouchers), count: vouchers.length };
}

/** Resets a failed queue item back to `queued` so `apps/tally-agent` picks it up on its next poll. */
export async function retryTallySync(c: Caller, i: z.output<typeof RetryTallySyncInput>) {
  requireRoles(c, 'cfo', 'super_admin');
  await col('tallyQueue').doc(i.queueId).update({ status: 'queued', lastError: null, retriedBy: c.uid, retriedAt: FieldValue.serverTimestamp() });
  return { id: i.queueId };
}
