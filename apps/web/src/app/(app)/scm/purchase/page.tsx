'use client';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AsnsTab, BoeTab, OrdersTab, RequisitionsTab, RfqsTab } from '@/components/scm/purchase';
import { PageHead, Tabbed } from '@/components/scm/kit';

type Tab = 'requisitions' | 'rfqs' | 'orders' | 'asns' | 'boe';
export default function PurchasePage() {
  return <React.Suspense><Inner /></React.Suspense>;
}
function Inner() {
  const sp = useSearchParams(); const router = useRouter();
  const tab = (sp.get('tab') as Tab) ?? 'orders'; const pr = sp.get('pr') ?? undefined;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHead back={{ href: '/scm', label: 'Supply chain' }} title="Purchasing" sub="Requisition → RFQ → purchase order, domestic and import." />
      <Tabbed<Tab> value={tab} onChange={(t) => router.replace(`/scm/purchase?tab=${t}`)} tabs={[
        { value: 'requisitions', label: 'Requisitions' }, { value: 'rfqs', label: 'RFQs & quotes' }, { value: 'orders', label: 'Purchase orders' }, { value: 'asns', label: 'Shipments (ASN)' }, { value: 'boe', label: 'Bills of Entry' },
      ]} />
      {tab === 'requisitions' && <RequisitionsTab />}
      {tab === 'rfqs' && <RfqsTab prId={pr} />}
      {tab === 'orders' && <OrdersTab prId={pr} />}
      {tab === 'asns' && <AsnsTab />}
      {tab === 'boe' && <BoeTab />}
    </div>
  );
}
