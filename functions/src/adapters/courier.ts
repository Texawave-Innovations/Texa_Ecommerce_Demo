import { createHash } from 'node:crypto';

/** Courier adapter (rule 10). The real Shiprocket REST API plugs in behind this interface; the mock below is deterministic so retries are idempotent. */
export interface BookingRequest { reference: string; fromPincode?: string; fromState?: string; toPincode: string; toState?: string; weightG: number; cod: boolean; codAmountPaise: number; declaredValuePaise: number }
export interface Booking { awb: string; courier: string; freightPaise: number; codFeePaise: number; etaDays: number; labelUrl: string; mock: boolean }
export interface CourierAdapter {
  readonly name: string;
  serviceable(pincode: string, cod: boolean): Promise<{ ok: boolean; reason?: string }>;
  book(r: BookingRequest): Promise<Booking>;
  cancel(awb: string): Promise<{ ok: boolean }>;
}

const COURIERS = ['Delhivery', 'Blue Dart', 'Xpressbees', 'Ecom Express'];
const h = (s: string) => parseInt(createHash('sha1').update(s).digest('hex').slice(0, 10), 16);

/** Mock Shiprocket. Zone by state match; pincodes starting 99 are unserviceable and COD is refused above ₹50,000 (demo rules). */
export class MockShiprocket implements CourierAdapter {
  readonly name = 'Shiprocket (mock)';
  async serviceable(pincode: string, cod: boolean) {
    if (!/^\d{6}$/.test(pincode)) return { ok: false, reason: `Invalid pincode ${pincode}` };
    if (pincode.startsWith('99')) return { ok: false, reason: `Pincode ${pincode} is not serviceable` };
    return cod && pincode.startsWith('19') ? { ok: false, reason: 'COD not available in this region' } : { ok: true };
  }
  async book(r: BookingRequest): Promise<Booking> {
    const s = await this.serviceable(r.toPincode, r.cod);
    if (!s.ok) throw new Error(`Courier booking refused: ${s.reason}`);
    if (r.cod && r.codAmountPaise > 5_000_000) throw new Error('Courier booking refused: COD above ₹50,000');
    const zone = r.fromState && r.toState && r.fromState.toLowerCase() === r.toState.toLowerCase() ? 1 : r.toPincode[0] === (r.fromPincode ?? '4')[0] ? 2 : 3;
    const slabs = Math.max(1, Math.ceil(r.weightG / 500));
    const freight = (4000 + 1500 * (slabs - 1)) * (zone === 1 ? 1 : zone === 2 ? 1.3 : 1.7);
    const num = h(`awb:${r.reference}`);
    return {
      awb: `SR${String(num).padStart(11, '0').slice(-11)}`, courier: COURIERS[num % COURIERS.length]!, freightPaise: Math.round(freight),
      codFeePaise: r.cod ? Math.max(3500, Math.round(r.codAmountPaise * 0.02)) : 0, etaDays: zone + 1, labelUrl: `mock://shiprocket/label/${r.reference}`, mock: true,
    };
  }
  async cancel() { return { ok: true }; }
}
export const courier: CourierAdapter = new MockShiprocket();

/** Maps Shiprocket's webhook `current_status` strings to our events. */
export function mapShiprocketStatus(s: string): 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'ndr' | 'rto_initiated' | 'rto_delivered' | null {
  const v = s.trim().toUpperCase();
  if (v === 'PICKED UP' || v === 'PICKUP DONE') return 'picked_up';
  if (v === 'IN TRANSIT' || v === 'SHIPPED') return 'in_transit';
  if (v === 'OUT FOR DELIVERY') return 'out_for_delivery';
  if (v === 'DELIVERED') return 'delivered';
  if (v === 'UNDELIVERED' || v === 'NDR') return 'ndr';
  if (v === 'RTO INITIATED' || v === 'RTO IN TRANSIT') return 'rto_initiated';
  if (v === 'RTO DELIVERED') return 'rto_delivered';
  return null;
}
