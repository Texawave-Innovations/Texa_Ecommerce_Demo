/**
 * Payment instruments that are NOT tenders for promotion purposes: gift cards, credit notes, loyalty points.
 * They settle part of the payable amount (partial redemption supported) and never change the taxable value.
 * Also holds loyalty earn / burn / tier rules.
 */
import { percentOf } from './money';

export const GIFT_CARD_MAX_BALANCE_PAISE = 1_000_000;   // ₹10,000 — small-PPI style cap
export const POINT_VALUE_PAISE = 100;                   // 1 Uni Point = ₹1
export const MAX_POINTS_PCT_OF_BILL = 50;
export const MIN_POINTS_TO_REDEEM = 50;

export interface GiftCard { id: string; balancePaise: number; status?: 'active' | 'blocked' | 'void'; expiresAt?: string; kind?: 'Physical' | 'E-gift' }
export interface CreditNote { id: string; balancePaise: number; status?: 'active' | 'void'; expiresAt?: string; customerId?: string }

export type InstrumentCheck = { ok: true; usablePaise: number } | { ok: false; reason: string };

const expired = (iso: string | undefined, at: Date) => !!iso && at.getTime() > Date.parse(iso.length <= 10 ? `${iso}T23:59:59.999+05:30` : iso);

export function checkGiftCard(c: GiftCard, at: Date): InstrumentCheck {
  if (c.status === 'blocked') return { ok: false, reason: 'Gift card is blocked' };
  if (c.status === 'void') return { ok: false, reason: 'Gift card is void' };
  if (expired(c.expiresAt, at)) return { ok: false, reason: 'Gift card has expired' };
  if (c.balancePaise <= 0) return { ok: false, reason: 'Gift card has no balance' };
  return { ok: true, usablePaise: c.balancePaise };
}
export function checkCreditNote(c: CreditNote, at: Date, customerId?: string): InstrumentCheck {
  if (c.status === 'void') return { ok: false, reason: 'Credit note is void' };
  if (expired(c.expiresAt, at)) return { ok: false, reason: 'Credit note has expired' };
  if (c.balancePaise <= 0) return { ok: false, reason: 'Credit note is fully used' };
  if (c.customerId && customerId && c.customerId !== customerId) return { ok: false, reason: 'Credit note belongs to another customer' };
  return { ok: true, usablePaise: c.balancePaise };
}

export interface Redemption { type: 'GC' | 'CN' | 'POINTS'; ref: string; appliedPaise: number; balanceAfterPaise: number; points?: number }

/** Partial redemption: applies min(balance, amount still due). Throws nothing; callers check `checkGiftCard` first for the reason. */
export function redeemBalance(type: 'GC' | 'CN', ref: string, balancePaise: number, duePaise: number): Redemption {
  const applied = Math.max(0, Math.min(balancePaise, duePaise));
  return { type, ref, appliedPaise: applied, balanceAfterPaise: balancePaise - applied };
}

export function topUpGiftCard(c: GiftCard, amountPaise: number, at: Date): { ok: true; balancePaise: number } | { ok: false; reason: string } {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) return { ok: false, reason: 'Top-up amount must be positive' };
  if (c.status === 'blocked' || c.status === 'void') return { ok: false, reason: `Gift card is ${c.status}` };
  if (expired(c.expiresAt, at)) return { ok: false, reason: 'Gift card has expired' };
  if (c.balancePaise + amountPaise > GIFT_CARD_MAX_BALANCE_PAISE) return { ok: false, reason: `Balance cannot exceed ₹${GIFT_CARD_MAX_BALANCE_PAISE / 100}` };
  return { ok: true, balancePaise: c.balancePaise + amountPaise };
}

/** Loyalty points as a payment instrument: 1 pt = ₹1, ≤ 50% of the bill, minimum 50 points. */
export function redeemPoints(balancePoints: number, requestedPoints: number, duePaise: number): { ok: true; points: number; valuePaise: number } | { ok: false; reason: string } {
  if (requestedPoints < MIN_POINTS_TO_REDEEM) return { ok: false, reason: `Minimum ${MIN_POINTS_TO_REDEEM} points to redeem` };
  if (requestedPoints > balancePoints) return { ok: false, reason: `Only ${balancePoints} points available` };
  const capPaise = percentOf(duePaise, MAX_POINTS_PCT_OF_BILL);
  const maxPts = Math.floor(capPaise / POINT_VALUE_PAISE);
  const pts = Math.min(requestedPoints, maxPts);
  if (pts < MIN_POINTS_TO_REDEEM) return { ok: false, reason: `Points can cover at most ${MAX_POINTS_PCT_OF_BILL}% of the bill` };
  return { ok: true, points: pts, valuePaise: pts * POINT_VALUE_PAISE };
}

export interface TierDef { id: string; minSpendPaise: number; earnRatePct: number; birthdayBonusPoints?: number }
/** Highest tier whose annual-spend threshold is met. */
export function tierFor(annualSpendPaise: number, tiers: TierDef[]): TierDef | undefined {
  return [...tiers].sort((a, b) => b.minSpendPaise - a.minSpendPaise).find((t) => annualSpendPaise >= t.minSpendPaise);
}
/** Earn: 1 point per ₹100 at the base rate (5%); tier `earnRatePct` scales it (Cutie ×1, Bestie ×1.4, Soulmate ×2). Earned on the discounted bill value. */
export function earnPoints(billValuePaise: number, tier?: Pick<TierDef, 'earnRatePct'>): number {
  const mult = (tier?.earnRatePct ?? 5) / 5;
  return Math.floor((billValuePaise / 10_000) * mult);
}
export const pointsExpiry = (earnedAt: Date, months = 12): Date => { const d = new Date(earnedAt); d.setUTCMonth(d.getUTCMonth() + months); return d; };
export const isBirthdayToday = (birthdayIso: string | undefined, at: Date): boolean => {
  if (!birthdayIso) return false; const t = new Date(at.getTime() + 5.5 * 3600_000);
  return birthdayIso.slice(5, 10) === `${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};
