'use client';
import * as React from 'react';
import { BillsTab, InvoicesTab, LandedTab, PaymentsTab } from '@/components/scm/payables';
import { PageHead, Tabbed } from '@/components/scm/kit';

type Tab = 'invoices' | 'bills' | 'payments' | 'landed';
export default function PayablesPage() {
  const [tab, setTab] = React.useState<Tab>('invoices');
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHead back={{ href: '/scm', label: 'Supply chain' }} title="Payables" sub="Invoice OCR → 3-way match → AP bill → payment with TDS · landed cost." />
      <Tabbed<Tab> value={tab} onChange={setTab} tabs={[{ value: 'invoices', label: 'Invoices & hold queue' }, { value: 'bills', label: 'AP bills' }, { value: 'payments', label: 'Payments' }, { value: 'landed', label: 'Landed cost' }]} />
      {tab === 'invoices' && <InvoicesTab />}{tab === 'bills' && <BillsTab />}{tab === 'payments' && <PaymentsTab />}{tab === 'landed' && <LandedTab />}
    </div>
  );
}
