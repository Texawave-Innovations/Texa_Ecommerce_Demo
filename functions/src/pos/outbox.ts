import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getAuth } from 'firebase-admin/auth';
import { CompleteSaleInput, ClaimsSchema } from '@texafashions/types';
import { FieldValue, REGION, col, type Caller } from '../admin';
import { completeSaleCore } from './sale';

async function callerOf(uid: string, name: string): Promise<Caller> {
  const u = await getAuth().getUser(uid);
  const claims = ClaimsSchema.parse(u.customClaims ?? {});
  return { uid, name: name || u.displayName || uid, claims };
}

/**
 * Finalises one offline sale: invoice number, stock, journal and points. Idempotent (the sale id IS the outbox id).
 * The sale keeps its provisional receipt number in `provisionalNo`.
 */
export async function finaliseOutboxNow(id: string) {
  const ref = col('posOutbox').doc(id);
  const d = (await ref.get()).data();
  if (!d || d.status !== 'pending') return { skipped: true };
  try {
    const caller = await callerOf(d.createdBy, d.cashierName);
    const input = CompleteSaleInput.parse({ ...d.input, clientSaleId: id });
    const sale = await completeSaleCore(caller, input, { offline: { provisionalNo: d.provisionalNo, at: new Date(d.createdAtClient), clientTotalPaise: d.clientTotalPaise } });
    await ref.update({ status: 'finalised', saleId: id, invoiceNo: sale.invoiceNo, needsReview: !!sale.needsReview, variancePaise: sale.variancePaise ?? 0, finalisedAt: FieldValue.serverTimestamp() });
    return { saleId: id, invoiceNo: sale.invoiceNo as string };
  } catch (e) {
    console.error('finaliseOutbox failed', id, e);
    await ref.update({ status: 'failed', error: (e as Error).message ?? 'failed', finalisedAt: FieldValue.serverTimestamp() });
    return { error: (e as Error).message };
  }
}

export const finaliseOutbox = onDocumentCreated({ document: 'orgs/{orgId}/posOutbox/{id}', region: REGION }, async (event) => {
  await finaliseOutboxNow(event.params.id);
});
