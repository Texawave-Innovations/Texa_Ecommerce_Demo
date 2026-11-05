import { renderEBill } from '@texafashions/domain';
import { messaging } from '../adapters/messaging';
import { plain } from './util';

/** Sends (mock) WhatsApp e-bill. Returns the message body so the POS can preview it. Best-effort for the automatic path. */
export async function sendEBillFor(sale: Record<string, any>, mobile: string, customerName?: string, pointsEarned?: number) {
  const body = renderEBill({
    customerName, invoiceNo: sale.invoiceNo, storeName: sale.storeName ?? sale.storeId, totalPaise: sale.payablePaise, savedPaise: sale.discountPaise ?? 0, pointsEarned,
    link: `https://texafashions.in/b/${String(sale.invoiceNo).replace(/\//g, '-')}`,
  });
  const r = await messaging.send({ channel: 'whatsapp', to: `+91${mobile}`, body, refType: 'sale', refId: sale.id });
  return { body, to: `+91${mobile}`, status: r.status };
}
export async function queueEBill(sale: Record<string, any>, customer: Record<string, any> | undefined) {
  try {
    if (!customer?.whatsappOptIn || !customer.mobile) return;
    await sendEBillFor(plain(sale), customer.mobile, customer.name, sale.pointsEarned);
  } catch (e) { console.warn('e-bill failed (ignored)', e); }
}
