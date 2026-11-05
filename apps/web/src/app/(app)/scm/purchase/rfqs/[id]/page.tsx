'use client';
import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Trophy } from 'lucide-react';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Select, Skeleton } from '@texafashions/ui';
import { scoreQuotes, toInrPaise } from '@texafashions/domain';
import { CURRENCIES, type Currency } from '@texafashions/types';
import { PageHead, StatusBadge, inr, minor, useCommand, useDoc, useMaster, useRows, useSkus } from '@/components/scm/kit';

type Doc = Record<string, any>;
export default function RfqDetail() {
  const { id } = useParams<{ id: string }>(); const router = useRouter();
  const rfq = useDoc('rfqs', id); const quotes = useRows('quotations', { where: [['rfqId', '==', id]] });
  const vendors = useMaster('vendors'); const { name } = useSkus(); const { run, busy } = useCommand();
  const [quoteFor, setQuoteFor] = React.useState<string | null>(null);
  if (rfq === undefined) return <Skeleton className="h-64" />;
  if (!rfq) return <EmptyState title="RFQ not found" kind="bear" />;
  const scores = scoreQuotes((quotes ?? []).map((q) => ({ vendorId: q.vendorId, totalInrPaise: q.totalInrPaise, leadTimeDays: q.leadTimeDays, stats: vendors.map.get(q.vendorId) ?? {} })));
  const rank = new Map(scores.map((s) => [s.vendorId, s]));
  const lines = rfq.lines as Doc[];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHead back={{ href: '/scm/purchase?tab=rfqs', label: 'RFQs' }} title={<>{rfq.number} <StatusBadge status={rfq.status} /></>} sub={`From ${rfq.prNumber} · ${lines.length} lines · ${(rfq.vendorIds as string[]).length} vendors invited`} />
      <Card className="p-0">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-card2 text-left text-xs text-soft"><tr><th className="p-3">Vendor</th>{lines.map((l) => <th key={l.skuId} className="p-3 text-right">{name(l.skuId)}<br /><span className="font-normal">× {l.qty}</span></th>)}<th className="p-3 text-right">Total (INR)</th><th className="p-3 text-right">Lead</th><th className="p-3 text-right">Vendor score</th><th className="p-3 text-right">Overall</th><th className="p-3" /></tr></thead>
          <tbody>{(rfq.vendorIds as string[]).map((vid) => {
            const q = quotes?.find((x) => x.vendorId === vid); const s = rank.get(vid);
            return (
              <tr key={vid} className="border-t border-line/60 align-middle">
                <td className="p-3"><b className="font-medium">{rfq.vendorNames?.[vid] ?? vid}</b>{s?.rank === 1 && <Badge tone="mint" className="ml-2"><Trophy className="size-3" />Best</Badge>}</td>
                {q ? lines.map((l) => <td key={l.skuId} className="num p-3">{minor(q.currency, (q.lines as Doc[]).find((x) => x.skuId === l.skuId)?.unitPriceMinor)}</td>)
                  : <td colSpan={lines.length} className="p-3 text-soft">No quote yet</td>}
                <td className="num p-3 font-medium">{q ? <>{inr(q.totalInrPaise)}<br /><span className="text-xs font-normal text-soft">{minor(q.currency, q.totalMinor)}</span></> : '—'}</td>
                <td className="num p-3">{q ? `${q.leadTimeDays}d` : '—'}</td>
                <td className="num p-3" title="40% on-time, 30% fill rate, 30% quality">{s?.reliability ?? '—'}</td>
                <td className="num p-3"><b>{s?.total ?? '—'}</b>{s && <span className="block text-[10px] text-soft">price {s.priceScore} · lead {s.leadScore}</span>}</td>
                <td className="p-3 text-right">{rfq.status === 'open' && (q ? <Button size="sm" disabled={busy} onClick={async () => { const r = await run('awardRFQ', { rfqId: id, vendorId: vid }, (x) => `Awarded → ${x.number}`); if (r) router.push(`/scm/purchase/orders/${r.id}`); }}>Award</Button> : <Button size="sm" variant="outline" onClick={() => setQuoteFor(vid)}>Enter quote</Button>)}
                  {rfq.status === 'awarded' && rfq.awardedVendorId === vid && <Badge tone="mint">Awarded</Badge>}</td>
              </tr>);
          })}</tbody>
        </table></div>
      </Card>
      <p className="text-xs text-soft">Overall = 50% price + 35% vendor reliability (on-time, fill rate, defects) + 15% lead time. Prices shown in the quoted currency; totals converted at the FX master rate.</p>
      <Dialog open={!!quoteFor} onClose={() => setQuoteFor(null)} title={`Quotation — ${quoteFor ? rfq.vendorNames?.[quoteFor] : ''}`} wide>
        {quoteFor && <QuoteForm rfqId={id} vendorId={quoteFor} lines={lines} defaultCurrency={String(vendors.map.get(quoteFor)?.currency ?? 'INR') as Currency} onDone={() => setQuoteFor(null)} />}
      </Dialog>
    </div>
  );
}
function QuoteForm({ rfqId, vendorId, lines, defaultCurrency, onDone }: { rfqId: string; vendorId: string; lines: Doc[]; defaultCurrency: Currency; onDone: () => void }) {
  const { name } = useSkus(); const { run, busy } = useCommand(); const fx = useMaster('fxRates');
  const [cur, setCur] = React.useState<Currency>(defaultCurrency); const [lead, setLead] = React.useState(30); const [inc, setInc] = React.useState('FOB');
  const [prices, setPrices] = React.useState<Record<string, number>>({});
  const rate = cur === 'INR' ? 100 : Number(fx.map.get(`FX-${cur}`)?.ratePaisePerUnit ?? 0);
  const total = lines.reduce((a, l) => a + l.qty * Math.round((prices[l.skuId] ?? 0) * 100), 0);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('submitQuotation', { rfqId, vendorId, currency: cur, leadTimeDays: lead, incoterm: inc, lines: lines.map((l) => ({ skuId: l.skuId, unitPriceMinor: Math.round((prices[l.skuId] ?? 0) * 100) })) }, 'Quotation recorded'); if (r) onDone(); }}>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Currency"><Select value={cur} onChange={(e) => setCur(e.target.value as Currency)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Lead time (days)"><Input type="number" value={lead} className="num" onChange={(e) => setLead(Number(e.target.value))} /></Field>
        <Field label="Incoterm"><Select value={inc} onChange={(e) => setInc(e.target.value)}>{['EXW', 'FOB', 'CIF', 'DDP'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
      </div>
      {lines.map((l) => <div key={l.skuId} className="grid grid-cols-[1fr_auto_140px] items-center gap-3"><span className="truncate text-sm">{name(l.skuId)}</span><span className="num text-xs text-soft">× {l.qty}</span><Input type="number" step="0.01" min={0} aria-label={`Unit price ${cur}`} className="num" value={prices[l.skuId] ?? ''} onChange={(e) => setPrices({ ...prices, [l.skuId]: Number(e.target.value) })} /></div>)}
      <Card className="flex justify-between bg-card2 p-4 text-sm"><span>Total</span><span className="num">{minor(cur, total)} {cur !== 'INR' && <span className="text-soft">≈ {inr(toInrPaise(total, rate || 0))}</span>}</span></Card>
      <div className="flex justify-end"><Button type="submit" loading={busy} disabled={lines.some((l) => !prices[l.skuId])}>Save quotation</Button></div>
    </form>
  );
}
