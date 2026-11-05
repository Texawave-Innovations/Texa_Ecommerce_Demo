/**
 * Tally agent (Phase 5): polls orgs/{org}/tallyQueue for `queued` items, POSTs each pre-rendered XML envelope to
 * TallyPrime's XML server (http://localhost:9000), and writes the outcome back to tallyQueue + tallySyncLog.
 *
 * `--mock` marks every queued item as sent without contacting Tally — useful when TallyPrime isn't installed.
 * `--once` processes whatever is queued right now and exits, instead of polling forever.
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';

process.env.GCLOUD_PROJECT ??= process.env.FIREBASE_PROJECT_ID ?? 'texafashions-demo';
if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db: Firestore = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const ORG_ID = 'texafashions';
const col = (name: string) => db.collection(`orgs/${ORG_ID}/${name}`);

const args = process.argv.slice(2);
const mock = args.includes('--mock');
const once = args.includes('--once');
const TALLY_URL = process.env.TALLY_URL ?? 'http://localhost:9000';
const POLL_MS = Number(process.env.TALLY_POLL_MS ?? 5000);
const BATCH = 20;

async function postToTally(xml: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (mock) return { ok: true };
  try {
    const res = await fetch(TALLY_URL, { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: xml, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, error: `TallyPrime responded ${res.status}` };
    const body = await res.text();
    if (/<LINEERROR>/.test(body)) return { ok: false, error: body.match(/<LINEERROR>(.*?)<\/LINEERROR>/)?.[1] ?? 'TallyPrime reported a line error' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Could not reach TallyPrime at ${TALLY_URL} (${(e as Error).message}) — is it running, or did you mean to pass --mock?` };
  }
}

async function processOne(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const item = doc.data();
  const result = await postToTally(item.xml);
  const at = FieldValue.serverTimestamp();
  if (result.ok) {
    await doc.ref.update({ status: 'sent', sentAt: at, lastError: null });
    await col('tallySyncLog').add({ queueId: doc.id, voucherType: item.voucherType, storeId: item.storeId, day: item.day, status: 'sent', mock, at });
    console.log(`✓ sent ${item.voucherType} ${item.refType}/${item.refId}${mock ? ' (mock)' : ''}`);
  } else {
    await doc.ref.update({ status: 'failed', lastError: result.error, attempts: FieldValue.increment(1) });
    await col('tallySyncLog').add({ queueId: doc.id, voucherType: item.voucherType, storeId: item.storeId, day: item.day, status: 'failed', error: result.error, mock, at });
    console.warn(`✗ failed ${item.voucherType} ${item.refType}/${item.refId}: ${result.error}`);
  }
}

async function pollOnce() {
  const snap = await col('tallyQueue').where('status', '==', 'queued').limit(BATCH).get();
  if (snap.empty) return 0;
  for (const doc of snap.docs) await processOne(doc);
  return snap.size;
}

async function main() {
  console.log(`tally-agent: polling orgs/${ORG_ID}/tallyQueue every ${POLL_MS}ms${mock ? ' in --mock mode (no TallyPrime contacted)' : ` → ${TALLY_URL}`}`);
  for (;;) {
    const n = await pollOnce();
    if (n) console.log(`processed ${n} item(s)`);
    if (once) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
