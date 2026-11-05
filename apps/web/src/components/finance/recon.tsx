'use client';
import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, RefreshCw, Sparkles, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState, StaggerGrid, cn } from '@texafashions/ui';
import { RECON_TYPES, reconTypeConfig } from '@texafashions/domain';
import type { ReconType } from '@texafashions/types';
import { DataTable, PageHead, Tabbed, dateStr, inr, useCommand, useRows } from '../scm/kit';
import { FinanceNav, type Doc } from './shared';

const TONE = { mint: '#BFE6D6', butter: '#FCE7A8', blush: '#F7C6D0' } as const;
const gaugeTone = (pct: number) => (pct >= 90 ? TONE.mint : pct >= 60 ? TONE.butter : TONE.blush);

/** Animated match-rate gauge (inline SVG arc — no charting library in this repo). */
function Gauge({ pct, size = 76 }: { pct: number; size?: number }) {
  const reduce = useReducedMotion();
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 text-ink" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" opacity={0.08} strokeWidth={8} />
      <motion.circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={gaugeTone(pct)} strokeWidth={8} strokeLinecap="round" strokeDasharray={c}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c - (c * Math.min(100, pct)) / 100 }}
        transition={reduce ? { duration: 0 } : { duration: 0.9, ease: 'easeOut' }}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill="currentColor" style={{ fontSize: size * 0.22, fontFamily: 'var(--font-display, inherit)' }}>{Math.round(pct)}%</text>
    </svg>
  );
}

const rowLabel = (rows: Doc[] | undefined) => (rows ?? []).filter(Boolean).map((r) => r.description || r.refNo || r.id).join(' + ') || '—';

/** One generic engine (`match()` in `@texafashions/domain`), 9 config-driven recon types. Tiles run + show a live
 * match-rate gauge; the detail card below lists matched/unmatched/AI-suggested rows for whichever tile is selected. */
export function ReconciliationCentre() {
  const [type, setType] = React.useState<ReconType>(RECON_TYPES[0]!.key as ReconType);
  const [tab, setTab] = React.useState<'matched' | 'unmatched' | 'suggested'>('matched');
  const runs = useRows('reconRuns', { limit: 500 });
  const items = useRows('reconItems', { where: [['type', '==', type]], limit: 500 });
  const { run, busy } = useCommand();
  const [runningType, setRunningType] = React.useState<ReconType | null>(null);

  const latestByType = React.useMemo(() => {
    const m = new Map<string, Doc>();
    (runs ?? []).forEach((r) => { if (!m.has(r.type)) m.set(r.type, r); }); // useRows sorts newest-first already
    return m;
  }, [runs]);

  const doRun = async (t: ReconType) => {
    setRunningType(t); setType(t);
    await run('runRecon', { type: t }, (r) => `${reconTypeConfig(t).label}: ${r.matchRatePct}% matched`);
    setRunningType(null);
  };
  const doAiSuggest = () => run('reconAiSuggest', { type }, (r) => (r.suggested ? `${r.suggested} AI suggestion${r.suggested === 1 ? '' : 's'} (${r.usedClaude ? 'Claude' : 'mock — no API key'})` : 'No confident suggestions found'));
  const decide = (itemId: string, decision: 'accept' | 'reject') => run('decideReconMatch', { itemId, decision }, decision === 'accept' ? 'Match accepted' : 'Suggestion rejected');

  const matched = (items ?? []).filter((i) => i.status === 'matched');
  const unmatched = (items ?? []).filter((i) => i.status === 'unmatched_source' || i.status === 'unmatched_target');
  const suggested = (items ?? []).filter((i) => i.status === 'ai_suggested');
  const config = reconTypeConfig(type);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHead title="Reconciliation Centre" sub="Bank, UPI, card, gateway, COD, cash, inventory vs GL, GST vs 2B and ERP vs Tally — nine recon types, one matching engine." />
      <FinanceNav current="/finance/recon" />

      <StaggerGrid className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {RECON_TYPES.map((t) => {
          const r = latestByType.get(t.key);
          const selected = t.key === type;
          return (
            <Card key={t.key} className={cn('flex cursor-pointer items-center gap-4 p-4', selected && 'ring-2 ring-cherry/50')} onClick={() => setType(t.key as ReconType)}>
              <Gauge pct={r?.matchRatePct ?? 0} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t.label}</p>
                <p className="truncate text-xs text-soft">{r ? `${r.matchedCount} matched · ${r.unmatchedSourceCount + r.unmatchedTargetCount} open` : 'Not run yet'}</p>
                <Button size="sm" variant="soft" className="mt-2" loading={busy && runningType === t.key} onClick={(e) => { e.stopPropagation(); void doRun(t.key as ReconType); }}>
                  <RefreshCw className="size-3.5" />Run
                </Button>
              </div>
            </Card>
          );
        })}
      </StaggerGrid>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium">{config.label}</h3>
            <p className="text-xs text-soft">{config.sourceLabel} vs {config.targetLabel}</p>
          </div>
          <Button size="sm" variant="outline" loading={busy} onClick={doAiSuggest}><Sparkles className="size-4" />AI suggest</Button>
        </div>
        <Tabbed
          value={tab} onChange={setTab}
          tabs={[
            { value: 'matched', label: `Matched (${matched.length})` },
            { value: 'unmatched', label: `Unmatched (${unmatched.length})` },
            { value: 'suggested', label: `AI suggested (${suggested.length})` },
          ]}
        />
        {tab === 'matched' && (
          <DataTable rows={items === null ? null : matched} empty={<EmptyState kind="capybara" title="No matches yet" hint="Click Run on the tile above." />} cols={[
            { key: 'source', header: config.sourceLabel, cell: (r) => rowLabel(r.sourceRows) },
            { key: 'target', header: config.targetLabel, cell: (r) => rowLabel(r.targetRows) },
            { key: 'amountPaise', header: 'Amount', align: 'right', cell: (r) => inr(r.amountPaise) },
            { key: 'rule', header: 'Rule', cell: (r) => <Badge tone="mint">{String(r.rule).replace(/_/g, ' ')}</Badge>, mobile: 'hide' },
            { key: 'confidence', header: 'Confidence', align: 'right', cell: (r) => `${Math.round((r.confidence ?? 1) * 100)}%` },
          ]} />
        )}
        {tab === 'unmatched' && (
          <DataTable rows={items === null ? null : unmatched} empty={<EmptyState kind="bunny" title="Nothing unmatched" hint="Everything reconciled." />} cols={[
            { key: 'side', header: 'Side', cell: (r) => <Badge tone="blush">{r.status === 'unmatched_source' ? config.sourceLabel : config.targetLabel}</Badge> },
            { key: 'row', header: 'Row', cell: (r) => rowLabel(r.status === 'unmatched_source' ? r.sourceRows : r.targetRows) },
            { key: 'date', header: 'Date', cell: (r) => dateStr((r.status === 'unmatched_source' ? r.sourceRows?.[0] : r.targetRows?.[0])?.date), mobile: 'hide' },
            { key: 'amountPaise', header: 'Amount', align: 'right', cell: (r) => inr(r.amountPaise) },
          ]} />
        )}
        {tab === 'suggested' && (
          <DataTable rows={items === null ? null : suggested} empty={<EmptyState kind="bear" title="No AI suggestions" hint="Click “AI suggest” to ask Claude to pair whatever’s left over." />} cols={[
            { key: 'source', header: config.sourceLabel, cell: (r) => rowLabel(r.sourceRows) },
            { key: 'target', header: config.targetLabel, cell: (r) => rowLabel(r.targetRows) },
            { key: 'amountPaise', header: 'Amount', align: 'right', cell: (r) => inr(r.amountPaise) },
            { key: 'confidence', header: 'Confidence', align: 'right', cell: (r) => `${Math.round((r.confidence ?? 0) * 100)}%`, mobile: 'hide' },
            { key: 'reason', header: 'Why', cell: (r) => <span className="text-xs text-soft">{r.reason ?? '—'}</span>, mobile: 'hide' },
            {
              key: 'actions', header: '', align: 'right', cell: (r) => (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="soft" aria-label="Accept match" onClick={() => decide(r.id, 'accept')}><Check className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Reject match" onClick={() => decide(r.id, 'reject')}><X className="size-3.5" /></Button>
                </div>
              ),
            },
          ]} />
        )}
      </Card>
    </div>
  );
}
