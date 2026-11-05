import { z } from 'zod';

export const ORG_ID = 'texafashions';
/** Money is integer paise everywhere. */
export const Paise = z.number().int();
/** Timestamps cross the repository boundary as ISO-8601 UTC strings. */
export const IsoDate = z.string();
export type IsoDate = z.infer<typeof IsoDate>;

export const STORE_CODES = [
  'PUN-PMC', 'MUM-PMC', 'BLR-CS', 'BLR-M5', 'BLR-FS', 'HYD-NX', 'HYD-SC', 'NSK-CC',
] as const;
export const WAREHOUSE_CODE = 'WH-CENTRAL';
