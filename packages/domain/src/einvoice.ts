/** Mock e-invoice (IRN/QR) generator — the real NIC IRP API plugs in behind this shape later. Deterministic per
 * invoice number so re-prints show the same IRN/QR, same pattern as the mock courier/payment adapters. Pure TS
 * (no `node:crypto`) — this package stays dependency-free so it can run anywhere, browser included. */

export interface MockEInvoice { irn: string; ackNo: string; ackDate: string; qrPayload: string; mock: true }

/** djb2 rolling hash, re-salted 8 times to fill out a 64-hex-char string shaped like a real NIC IRN (SHA-256 hex digest). */
export function generateMockIrn(gstin: string, invoiceNo: string, invoiceDate: string): string {
  const seed = `${gstin}|INV|${invoiceNo}|${invoiceDate}`;
  let out = '';
  for (let salt = 0; salt < 8; salt++) {
    let h = 5381 + salt;
    for (let i = 0; i < seed.length; i++) h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}

/** Builds the mock IRN + a QR payload shaped like the NIC e-invoice QR (pipe-delimited core fields). */
export function buildMockEInvoice(input: { gstin: string; invoiceNo: string; invoiceDate: string; payablePaise: number; customerGstin?: string | null }): MockEInvoice {
  const irn = generateMockIrn(input.gstin, input.invoiceNo, input.invoiceDate);
  const ackNo = irn.slice(0, 12).toUpperCase();
  const qrPayload = [input.gstin, input.customerGstin ?? '', input.invoiceNo, input.invoiceDate, (input.payablePaise / 100).toFixed(2), irn].join('|');
  return { irn, ackNo, ackDate: input.invoiceDate, qrPayload, mock: true };
}
