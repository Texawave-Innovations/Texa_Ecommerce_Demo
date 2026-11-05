'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, Kpi, Mascot, StaggerGrid, Skeleton } from '@texafashions/ui';
import { DEMO_USERS, MASTERS, ROLE_LABELS } from '@texafashions/types';
import { data } from '@/lib/data';
import { useSession } from '@/lib/stores';
import { BriefingCard } from '@/components/notifications';

export default function Dashboard() {
  const s = useSession((x) => x.session!);
  const router = useRouter();
  React.useEffect(() => { if (s.claims.role === 'vendor') router.replace('/vendor'); }, [s.claims.role, router]);
  const u = DEMO_USERS.find((d) => d.role === s.claims.role);
  const counts = useQuery({
    queryKey: ['home-counts'],
    queryFn: async () => {
      const [skus, stores, vendors, customers] = await Promise.all(['skus', 'stores', 'vendors', 'customers'].map((m) => data().masters.list(m, { limit: 3000 }).then((r) => r.length).catch(() => 0)));
      return { skus: skus!, stores: stores!, vendors: vendors!, customers: customers! };
    },
  });
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <Card className="flex flex-col items-start justify-between gap-4 bg-gradient-to-br from-blush/50 via-card to-butter/40 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-3xl">Welcome back, {s.name.split(" ")[0]} 👋</h1>
          <p className="mt-1 text-sm text-soft">You&apos;re signed in as <b>{ROLE_LABELS[s.claims.role]}</b>. {u?.blurb}.</p>
          <div className="mt-3 flex flex-wrap gap-2"><Badge tone="mint">12 modules</Badge><Badge tone="lavender">Live demo data</Badge></div>
        </div>
        <Mascot kind="capybara" size={96} />
      </Card>
      {counts.isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[116px]" />)}</div>
      ) : (
        <StaggerGrid className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi label="SKUs" value={counts.data?.skus ?? 0} tone="blush" hint="Active in catalogue" />
          <Kpi label="Stores" value={counts.data?.stores ?? 0} tone="mint" hint="Malls across 4 cities" />
          <Kpi label="Vendors" value={counts.data?.vendors ?? 0} tone="sky" hint="KR · CN · IN" />
          <Kpi label="Customers" value={counts.data?.customers ?? 0} tone="lavender" hint="With loyalty tiers" />
        </StaggerGrid>
      )}
      <BriefingCard />
      <Card>
        <div className="flex flex-wrap gap-2">
          <Link href="/master/skus" className="rounded-pill bg-cherry px-5 py-2 text-sm text-cherry-ink shadow-pop">Open SKUs</Link>
          <Link href="/master/approvals" className="rounded-pill bg-blush/60 px-5 py-2 text-sm">Approvals queue</Link>
          <Link href="/design" className="rounded-pill border border-line px-5 py-2 text-sm">Design system</Link>
          <span className="rounded-pill border border-line px-5 py-2 text-sm text-soft">{MASTERS.length} masters available</span>
        </div>
      </Card>
    </div>
  );
}
