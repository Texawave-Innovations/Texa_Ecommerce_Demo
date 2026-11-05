/** GST adapter (rule 10). The real NIC e-invoice IRP / GSTR-2B download API plugs in behind this interface; the mock
 * below is deterministic (same invoice → same IRN), same contract as the mock courier/payment adapters. */
import { buildMockEInvoice, type MockEInvoice } from '@texafashions/domain';

export interface GstAdapter {
  readonly name: string;
  generateEInvoice(input: { gstin: string; invoiceNo: string; invoiceDate: string; payablePaise: number; customerGstin?: string | null }): Promise<MockEInvoice>;
}

export class MockGst implements GstAdapter {
  readonly name = 'NIC e-invoice IRP (mock)';
  async generateEInvoice(input: { gstin: string; invoiceNo: string; invoiceDate: string; payablePaise: number; customerGstin?: string | null }) {
    return buildMockEInvoice(input);
  }
}
export const gst: GstAdapter = new MockGst();
