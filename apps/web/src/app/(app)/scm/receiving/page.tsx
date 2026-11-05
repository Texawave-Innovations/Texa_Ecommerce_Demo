'use client';
import * as React from 'react';
import { GateTab, GrnTab, PutawayTab, QcTab, ReturnsTab } from '@/components/scm/receiving';
import { PageHead, Tabbed } from '@/components/scm/kit';

type Tab = 'gate' | 'grn' | 'qc' | 'putaway' | 'returns';
export default function ReceivingPage() {
  const [tab, setTab] = React.useState<Tab>('grn');
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHead back={{ href: '/scm', label: 'Supply chain' }} title="Receiving" sub="Gate entry → GRN by scan → QC → putaway, plus returns to vendor." />
      <Tabbed<Tab> value={tab} onChange={setTab} tabs={[{ value: 'gate', label: 'Gate entry' }, { value: 'grn', label: 'Goods receipts' }, { value: 'qc', label: 'Quality check' }, { value: 'putaway', label: 'Putaway' }, { value: 'returns', label: 'Returns & debit notes' }]} />
      {tab === 'gate' && <GateTab />}{tab === 'grn' && <GrnTab />}{tab === 'qc' && <QcTab />}{tab === 'putaway' && <PutawayTab />}{tab === 'returns' && <ReturnsTab />}
    </div>
  );
}
