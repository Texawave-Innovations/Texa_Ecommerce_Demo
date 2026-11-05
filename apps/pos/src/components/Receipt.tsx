'use client';
import * as React from 'react';
import QRCode from 'qrcode';
import type { SaleDoc, ZReportDoc } from '@texafashions/types';
import { isProvisionalNo } from '@texafashions/domain';
import { fmtDateTime, inr } from '@/lib/stores';

export function QrSvg({ value, size = 160, className }: { value: string; size?: number; className?: string }) {
  const [svg, setSvg] = React.useState('');
  React.useEffect(() => { let live = true; QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }).then((s) => live && setSvg(s)).catch(() => undefined); return () => { live = false; }; }, [value]);
  return <div className={className} style={{ width: size, height: size }} role="img" aria-label="QR code" dangerouslySetInnerHTML={{ __html: svg.replace('<svg', `<svg width="${size}" height="${size}"`) }} />;
}

const MODE_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', GC: 'Gift card', CN: 'Credit note', POINTS: 'Uni Points' };

/** 80 mm thermal GST invoice. Printed via window.print() (see `.receipt-print` in globals.css). */
export function Receipt({ sale, print = true }: { sale: SaleDoc; print?: boolean }) {
  const prov = isProvisionalNo(sale.invoiceNo);
  const taxTotal = sale.totalTaxPaise;
  const qty = sale.lines.reduce((a, l) => a + l.qty, 0);
  return (
    <div className={`receipt ${print ? 'receipt-print' : ''} shadow-soft`} data-testid="receipt">
      <h1>TEXA FASHIONS</h1>
      <div className="c">{sale.storeName ?? sale.storeId}</div>
      {sale.storeGstin && <div className="c">GSTIN {sale.storeGstin}</div>}
      <div className="c b" style={{ marginTop: 3 }}>{sale.status === 'voided' ? 'VOIDED TAX INVOICE' : 'TAX INVOICE'}</div>
      {prov && <div className="prov">PROVISIONAL RECEIPT<br /><span style={{ fontWeight: 400 }}>Final GST invoice no. follows once synced</span></div>}
      <hr />
      <div className="row"><span>Bill</span><span className="b" data-testid="receipt-invoice">{sale.invoiceNo}</span></div>
      <div className="row"><span>Date</span><span>{fmtDateTime(sale.createdAt)}</span></div>
      <div className="row"><span>Cashier</span><span>{sale.cashierName} · {sale.tillId}</span></div>
      {sale.customer && <div className="row"><span>Customer</span><span>{sale.customer.name}</span></div>}
      <hr />
      <table>
        <tbody>
          {sale.lines.map((l) => (
            <React.Fragment key={l.lineId}>
              <tr><td colSpan={3}>{l.name}{l.hsn ? ` (${l.hsn})` : ''}</td></tr>
              <tr><td>{l.qty} × {(l.grossPaise / l.qty / 100).toFixed(2)}</td><td className="r" style={{ width: 52 }}>{l.gstRate}%</td><td className="r" style={{ width: 66 }}>{(l.grossPaise / 100).toFixed(2)}</td></tr>
              {l.discountPaise > 0 && <tr><td colSpan={2} style={{ paddingLeft: 8 }}>{l.isFreeGift ? 'Free gift' : 'Discount'}</td><td className="r">-{(l.discountPaise / 100).toFixed(2)}</td></tr>}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      <hr />
      <div className="row"><span>Items {sale.lines.length} / Qty {qty}</span><span>{(sale.grossPaise / 100).toFixed(2)}</span></div>
      {sale.applied.map((a) => <div key={a.promoId} className="row"><span>{a.name}</span><span>-{(a.amountPaise / 100).toFixed(2)}</span></div>)}
      <hr />
      <table>
        <thead><tr><td className="b">GST</td><td className="r b">Taxable</td><td className="r b">CGST</td><td className="r b">SGST</td></tr></thead>
        <tbody>{sale.taxSummary.map((t) => <tr key={t.gstRate}><td>{t.gstRate}%</td><td className="r">{(t.taxablePaise / 100).toFixed(2)}</td><td className="r">{((t.cgstPaise || t.igstPaise) / 100).toFixed(2)}</td><td className="r">{(t.sgstPaise / 100).toFixed(2)}</td></tr>)}</tbody>
      </table>
      <div className="row"><span>Total GST</span><span>{(taxTotal / 100).toFixed(2)}</span></div>
      {sale.roundOffPaise !== 0 && <div className="row"><span>Round off</span><span>{(sale.roundOffPaise / 100).toFixed(2)}</span></div>}
      <hr />
      <div className="row big"><span>TOTAL</span><span data-testid="receipt-total">₹{(sale.payablePaise / 100).toFixed(2)}</span></div>
      {sale.payments.map((p, i) => <div key={i} className="row"><span>{MODE_LABEL[p.mode] ?? p.mode}{p.ref ? ` ${String(p.ref).slice(-6)}` : ''}</span><span>{(p.amountPaise / 100).toFixed(2)}</span></div>)}
      {sale.changeGivenPaise > 0 && <div className="row"><span>Change</span><span>{(sale.changeGivenPaise / 100).toFixed(2)}</span></div>}
      <hr />
      {sale.discountPaise > 0 && <div className="c b">You saved {inr(sale.discountPaise)} today!</div>}
      {(sale.pointsEarned > 0 || sale.pointsRedeemed > 0) && <div className="c">Uni Points: +{sale.pointsEarned}{sale.pointsRedeemed ? ` / −${sale.pointsRedeemed}` : ''}</div>}
      <div className="c" style={{ margin: '6px 0 2px' }}><QrSvg value={sale.billQr} size={92} className="mx-auto" /></div>
      <div className="c" style={{ fontSize: 10 }}>Scan this bill QR for returns & exchanges</div>
      {sale.einvoice && (
        <>
          <hr />
          <div className="c" style={{ margin: '4px 0 2px' }}><QrSvg value={sale.einvoice.qrPayload} size={92} className="mx-auto" /></div>
          <div className="c" style={{ fontSize: 10 }}>e-Invoice IRN (mock)</div>
          <div className="c" style={{ fontSize: 9, wordBreak: 'break-all' }}>{sale.einvoice.irn}</div>
          <div className="c" style={{ fontSize: 10 }}>Ack no. {sale.einvoice.ackNo} · {sale.einvoice.ackDate}</div>
        </>
      )}
      <div className="c" style={{ marginTop: 4 }}>Thank you! 🐻</div>
      <div className="c" style={{ fontSize: 10 }}>Exchange within 7 days with bill · texafashions.in</div>
    </div>
  );
}

/** Z-report on 80 mm paper. */
export function ZReceipt({ z }: { z: ZReportDoc }) {
  const row = (l: string, v: number, b = false) => <div className={`row ${b ? 'b' : ''}`}><span>{l}</span><span>{inr(v)}</span></div>;
  return (
    <div className="receipt receipt-print shadow-soft" data-testid="z-receipt">
      <h1>Z-REPORT</h1>
      <div className="c">{z.storeId} · {z.tillId} · {z.shiftNo}</div>
      <div className="c">{z.cashierName}</div>
      <div className="c">{fmtDateTime(z.openedAt)} → {fmtDateTime(z.closedAt)}</div>
      <hr />
      <div className="row"><span>Bills</span><span>{z.billCount}</span></div>
      {row('Gross sales', z.grossSalesPaise)}{row('Discounts', -z.discountPaise)}{row('GST collected', z.taxPaise)}{row('Returns / voids', -z.returnsPaise)}{row('NET SALES', z.netSalesPaise, true)}
      <hr /><div className="b">By tender</div>
      {Object.entries(z.byTender).map(([k, v]) => <div key={k} className="row"><span>{MODE_LABEL[k] ?? k}</span><span>{inr(v)}</span></div>)}
      <hr /><div className="b">Cash drawer</div>
      {row('Opening float', z.openingFloatPaise)}{row('Cash sales (net of change)', z.cashSalesPaise)}{row('Cash refunds', -z.cashRefundsPaise)}
      {z.paidInPaise > 0 && row('Paid in', z.paidInPaise)}{z.paidOutPaise > 0 && row('Paid out', -z.paidOutPaise)}
      {row('Expected', z.expectedCashPaise, true)}{row('Counted', z.countedCashPaise, true)}
      <div className="row big"><span>Variance</span><span>{z.variancePaise > 0 ? '+' : ''}{inr(z.variancePaise)}</span></div>
      {z.managerApprovedBy && <div className="c" style={{ marginTop: 4 }}>Signed off by {z.managerApprovedBy}</div>}
      <hr /><div className="c" style={{ fontSize: 10 }}>Voids {z.voidCount} · Returns {z.returnCount}</div>
    </div>
  );
}
