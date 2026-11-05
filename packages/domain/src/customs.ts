export interface DutyInput { assessableValuePaise: number; bcdPct: number; swsPctOfBcd?: number; igstPct: number }
export interface DutyResult { bcdPaise: number; swsPaise: number; igstBasePaise: number; igstPaise: number; landedAddPaise: number }

/** Indian import duty: BCD on assessable value, SWS = 10% of BCD, IGST on (AV + BCD + SWS). IGST is creditable, not cost. */
export function importDuty(i: DutyInput): DutyResult {
  const bcd = Math.round((i.assessableValuePaise * i.bcdPct) / 100);
  const sws = Math.round((bcd * (i.swsPctOfBcd ?? 10)) / 100);
  const base = i.assessableValuePaise + bcd + sws;
  const igst = Math.round((base * i.igstPct) / 100);
  return { bcdPaise: bcd, swsPaise: sws, igstBasePaise: base, igstPaise: igst, landedAddPaise: bcd + sws };
}
