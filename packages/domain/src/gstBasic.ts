/** Minimal GST split used by SCM documents. The full GST engine (returns, e-invoice) lands in Phase 5. */
export interface GstSplit { cgstPaise: number; sgstPaise: number; igstPaise: number; totalTaxPaise: number }
export function splitGst(taxablePaise: number, ratePct: number, intraState: boolean): GstSplit {
  const tax = Math.round((taxablePaise * ratePct) / 100);
  if (!intraState) return { cgstPaise: 0, sgstPaise: 0, igstPaise: tax, totalTaxPaise: tax };
  const cgst = Math.floor(tax / 2);
  return { cgstPaise: cgst, sgstPaise: tax - cgst, igstPaise: 0, totalTaxPaise: tax };
}
export const stateCodeOf = (gstin?: string | null) => (gstin && gstin.length >= 2 ? gstin.slice(0, 2) : '');
export const isIntraState = (a?: string | null, b?: string | null) => !!a && !!b && stateCodeOf(a) === stateCodeOf(b);

/** E-way bill is mandatory for consignments above ₹50,000. */
export const EWAY_THRESHOLD_PAISE = 5_000_000;
export const ewayRequired = (consignmentValuePaise: number) => consignmentValuePaise > EWAY_THRESHOLD_PAISE;
