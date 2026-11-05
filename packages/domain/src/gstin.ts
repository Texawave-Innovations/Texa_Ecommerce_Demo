const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const GST_STATE_CODES: Record<string, string> = {
  Maharashtra: '27', Karnataka: '29', Telangana: '36', Delhi: '07', 'Tamil Nadu': '33', Gujarat: '24',
};

/** GSTIN mod-36 checksum validation. */
export function isValidGstin(gstin: string): boolean {
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return false;
  return gstinCheckChar(gstin.slice(0, 14)) === gstin[14];
}

export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]!);
    const prod = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36]!;
}

/** Build a syntactically valid demo GSTIN for a state code + PAN. */
export function makeGstin(stateCode: string, pan: string, entity = '1'): string {
  const base = `${stateCode}${pan}${entity}Z`;
  return base + gstinCheckChar(base);
}
