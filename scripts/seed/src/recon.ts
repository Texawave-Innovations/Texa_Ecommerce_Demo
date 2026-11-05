/** Phase 5 seed: loads the Reconciliation Centre's sample CSVs (one per recon type, `side` column = source/target)
 * into `reconFeeds`. Each row becomes one doc; `runRecon` reads this collection straight — no transform needed. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORG_ID } from '@texafashions/types';
import type { Firestore } from 'firebase-admin/firestore';

const RECON_DIR = fileURLToPath(new URL('../recon', import.meta.url));

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n').filter(Boolean);
  const headers = lines[0]!.split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
  });
}

export async function seedRecon(db: Firestore) {
  const col = (c: string) => db.collection(`orgs/${ORG_ID}/${c}`);
  const files = readdirSync(RECON_DIR).filter((f) => f.endsWith('.csv'));
  let total = 0;
  for (const file of files) {
    const type = file.replace(/\.csv$/, '');
    const rows = parseCsv(readFileSync(join(RECON_DIR, file), 'utf8'));
    const batch = db.batch();
    rows.forEach((r, i) => {
      batch.set(col('reconFeeds').doc(`${type}_${r.side}_${i}`), {
        type, side: r.side, refNo: r.refNo || null, amountPaise: Number(r.amountPaise), date: r.date, description: r.description ?? '',
      });
    });
    await batch.commit();
    total += rows.length;
  }
  console.log(`  · reconFeeds: ${total} rows across ${files.length} recon types`);
}
