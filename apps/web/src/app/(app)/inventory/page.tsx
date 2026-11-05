'use client';
import * as React from 'react';
import { AdjustmentsTab, AgeingTab, CountsTab, CoverTab, StockTab, ValuationTab } from '@/components/scm/inventory';
import { PageHead, Tabbed } from '@/components/scm/kit';

type Tab = 'stock' | 'cover' | 'ageing' | 'valuation' | 'counts' | 'adjustments';
export default function InventoryPage() {
  const [tab, setTab] = React.useState<Tab>('stock');
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHead title="Inventory" sub="Stock by location and state, ledger drill-down, counts, valuation and ageing." />
      <Tabbed<Tab> value={tab} onChange={setTab} tabs={[{ value: 'stock', label: 'Stock' }, { value: 'cover', label: 'Days of cover' }, { value: 'ageing', label: 'Ageing & dead stock' }, { value: 'valuation', label: 'Valuation' }, { value: 'counts', label: 'Counts' }, { value: 'adjustments', label: 'Adjustments' }]} />
      {tab === 'stock' && <StockTab />}{tab === 'cover' && <CoverTab />}{tab === 'ageing' && <AgeingTab />}{tab === 'valuation' && <ValuationTab />}{tab === 'counts' && <CountsTab />}{tab === 'adjustments' && <AdjustmentsTab />}
    </div>
  );
}
