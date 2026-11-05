'use client';
import * as React from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { Badge, Button, EmptyState } from '@texafashions/ui';
import { DataTable, PageHead, dateStr, useCommand, useRows } from '../scm/kit';
import { downloadXml, FinanceNav, type Doc } from './shared';

const STATUS_TONE: Record<string, 'butter' | 'mint' | 'cherry'> = { queued: 'butter', sent: 'mint', failed: 'cherry' };

/** `tallyQueue` is populated by the `enqueueTallySync` trigger as every GL journal posts; `apps/tally-agent` polls it,
 * POSTs the pre-rendered XML to TallyPrime (`:9000`), and writes the outcome back here. */
export function TallySync() {
  const rows = useRows('tallyQueue', { limit: 300 });
  const { run, busy } = useCommand();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHead title="Tally sync" sub="Every posted journal queued as a TallyPrime voucher. apps/tally-agent polls this queue and posts to TallyPrime at :9000 (or run it with --mock to mark items sent without a live Tally)." />
      <FinanceNav current="/finance/tally-sync" />
      <DataTable rows={rows} empty={<EmptyState kind="bear" title="Nothing queued yet" />} cols={[
        { key: 'day', header: 'Date', cell: (r) => dateStr(r.day) },
        { key: 'voucherType', header: 'Voucher type' },
        { key: 'storeId', header: 'Cost centre' },
        { key: 'refType', header: 'Source', cell: (r) => <span className="text-xs text-soft">{r.refType} · {r.refId}</span>, mobile: 'hide' },
        { key: 'status', header: 'Status', cell: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'lavender'}>{r.status}</Badge> },
        {
          key: 'actions', header: '', align: 'right', cell: (r) => (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => downloadXml(`tally-${r.voucherType}-${r.id}.xml`, r.xml)}><Download className="size-4" />Export XML</Button>
              {r.status === 'failed' && <Button size="sm" variant="soft" loading={busy} onClick={() => run('retryTallySync', { queueId: r.id }, 'Re-queued for the agent')}><RefreshCw className="size-4" />Retry</Button>}
            </div>
          ),
        },
      ]} />
      {(rows ?? []).some((r: Doc) => r.status === 'failed') && <p className="text-xs text-soft">Failed items usually mean the agent couldn't reach TallyPrime at <code>localhost:9000</code> — start TallyPrime (or run the agent with <code>--mock</code>), then retry.</p>}
    </div>
  );
}
