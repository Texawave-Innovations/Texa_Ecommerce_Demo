'use client';
import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@texafashions/ui';
import type { CommandInput, CommandName } from '@texafashions/types';
import { data } from '@/lib/data';
import { useSession } from '@/lib/stores';

export type Doc = Record<string, any>;
export const HQ_FIN_ROLES = ['super_admin', 'cfo', 'auditor'];
export const useRole = () => useSession((s) => s.session!.claims.role);

const LINKS = [
  { href: '/finance', label: 'Chart of accounts' }, { href: '/finance/journals', label: 'Journals' },
  { href: '/finance/ap-ageing', label: 'AP ageing' }, { href: '/finance/ar-ageing', label: 'AR ageing' },
  { href: '/finance/store-pnl', label: 'Store P&L' }, { href: '/finance/budget-vs-actual', label: 'Budget vs actual' },
  { href: '/finance/gst', label: 'GST' }, { href: '/finance/tally-sync', label: 'Tally sync' },
  { href: '/finance/recon', label: 'Reconciliation' },
];

/** Browser-side CSV download ("export to Excel" — Excel opens CSV natively; no spreadsheet library needed for this demo). */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  downloadBlob(filename, csv, 'text/csv;charset=utf-8;');
}
export function downloadXml(filename: string, xml: string) { downloadBlob(filename, xml, 'application/xml;charset=utf-8;'); }
function downloadBlob(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
/** Sub-navigation shared by the six Finance screens. */
export function FinanceNav({ current }: { current: string }) {
  return (
    <nav aria-label="Finance sections" className="flex w-full gap-1 overflow-x-auto rounded-pill bg-card2 p-1">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={current === l.href ? 'page' : undefined} className={cn('whitespace-nowrap rounded-pill px-4 py-1.5 text-sm', current === l.href ? 'bg-card font-medium shadow-soft' : 'text-soft hover:text-ink')}>{l.label}</Link>
      ))}
    </nav>
  );
}

/** Runs a report callable (a pure read, no mutation) with a short polling refresh. */
export function useReport<K extends CommandName>(name: K, input: CommandInput<K>, enabled = true) {
  return useQuery({ queryKey: ['finance-report', name, input], queryFn: () => data().scm.command(name, input) as Promise<Doc>, enabled, staleTime: 15_000 });
}

/** Minimal hand-rolled horizontal bar chart (Texa Soft palette) — no charting library in this repo yet. */
export function Bars({ rows, max, tone = 'sky' }: { rows: { label: string; value: number; sub?: string }[]; max?: number; tone?: 'sky' | 'mint' | 'blush' | 'lavender' | 'butter' }) {
  const top = max ?? Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const bg: Record<string, string> = { sky: 'bg-sky', mint: 'bg-mint', blush: 'bg-blush', lavender: 'bg-lavender', butter: 'bg-butter' };
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 truncate" title={r.label}>{r.label}</span>
          <div className="h-5 flex-1 overflow-hidden rounded-pill bg-card2">
            <div className={cn('h-full rounded-pill', bg[tone], r.value < 0 && 'bg-cherry')} style={{ width: `${Math.min(100, (Math.abs(r.value) / top) * 100)}%` }} />
          </div>
          <span className="num w-28 shrink-0 text-right text-xs text-soft">{r.sub ?? r.value}</span>
        </div>
      ))}
    </div>
  );
}
