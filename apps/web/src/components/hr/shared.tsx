'use client';
import * as React from 'react';
import Link from 'next/link';
import { cn } from '@texafashions/ui';
import { useSession } from '@/lib/stores';

export type Doc = Record<string, any>;
export const useRole = () => useSession((s) => s.session!.claims.role);
export const HR_APPROVER_ROLES = ['hr_manager', 'store_manager'];

const LINKS = [
  { href: '/hr', label: 'Overview' }, { href: '/hr/employees', label: 'Employees' }, { href: '/hr/recruitment', label: 'Recruitment' },
  { href: '/hr/attendance', label: 'Attendance' }, { href: '/hr/leave', label: 'Leave' }, { href: '/hr/roster', label: 'Roster' },
  { href: '/hr/payroll', label: 'Payroll' }, { href: '/hr/me', label: 'My workspace' },
];
export function HrNav({ current }: { current: string }) {
  return (
    <nav aria-label="HR sections" className="flex w-full gap-1 overflow-x-auto rounded-pill bg-card2 p-1">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={current === l.href ? 'page' : undefined} className={cn('whitespace-nowrap rounded-pill px-4 py-1.5 text-sm', current === l.href ? 'bg-card font-medium shadow-soft' : 'text-soft hover:text-ink')}>{l.label}</Link>
      ))}
    </nav>
  );
}
/** Local YYYY-MM-DD (never toISOString — that shifts to UTC and can land on the wrong calendar day for IST users). */
export const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayStr = () => ymdLocal(new Date());
export const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');
export const dateStr = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');
/** Monday of the week containing `d`. */
export function mondayOf(d: Date): Date { const day = (d.getDay() + 6) % 7; return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day); }
export const ymd = ymdLocal;
