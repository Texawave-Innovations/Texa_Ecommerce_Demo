'use client';
import * as React from 'react';
import Link from 'next/link';
import { cn } from '@texafashions/ui';
import { useSession } from '@/lib/stores';

export type Doc = Record<string, any>;
export const HQ_ROLES = ['super_admin', 'cfo', 'buyer', 'warehouse_manager', 'auditor'];
export const useRole = () => useSession((s) => s.session!.claims.role);

const LINKS = [
  { href: '/oms', label: 'Orders' }, { href: '/oms/fulfilment', label: 'Fulfilment' }, { href: '/oms/returns', label: 'Returns & COD' }, { href: '/oms/sync', label: 'Sync health' },
];
/** Sub-navigation shared by the four OMS screens. */
export function OmsNav({ current }: { current: string }) {
  const role = useRole();
  return (
    <nav aria-label="OMS sections" className="flex w-full gap-1 overflow-x-auto rounded-pill bg-card2 p-1">
      {LINKS.filter((l) => HQ_ROLES.includes(role) || l.href === '/oms/fulfilment' || l.href === '/oms/returns').map((l) => (
        <Link key={l.href} href={l.href} aria-current={current === l.href ? 'page' : undefined} className={cn('whitespace-nowrap rounded-pill px-4 py-1.5 text-sm', current === l.href ? 'bg-card font-medium shadow-soft' : 'text-soft hover:text-ink')}>{l.label}</Link>
      ))}
    </nav>
  );
}
export const hoursLeft = (iso?: string | null) => (iso ? (new Date(iso).getTime() - Date.now()) / 3600_000 : null);
export const ago = (iso?: string | null) => {
  if (!iso) return '—'; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
export const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');
