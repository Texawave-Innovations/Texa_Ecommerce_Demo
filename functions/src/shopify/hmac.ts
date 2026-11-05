import { createHmac, timingSafeEqual } from 'node:crypto';
import { defineSecret } from 'firebase-functions/params';
import { DEV_SHIPROCKET_TOKEN, DEV_SHOPIFY_SECRET } from '@texafashions/types';

export const SHOPIFY_WEBHOOK_SECRET = defineSecret('SHOPIFY_WEBHOOK_SECRET');
export const SHIPROCKET_WEBHOOK_TOKEN = defineSecret('SHIPROCKET_WEBHOOK_TOKEN');

function secretValue(s: { value(): string }, devFallback: string): string {
  let v = '';
  try { v = s.value(); } catch { /* not bound */ }
  v ||= process.env[(s as unknown as { name: string }).name] ?? '';
  return v || devFallback; // demo: fall back to the dev secret
}
export const shopifySecret = () => secretValue(SHOPIFY_WEBHOOK_SECRET, DEV_SHOPIFY_SECRET);
export const shiprocketToken = () => secretValue(SHIPROCKET_WEBHOOK_TOKEN, DEV_SHIPROCKET_TOKEN);

/** Shopify signs the RAW body: base64(HMAC-SHA256(secret, body)) in `X-Shopify-Hmac-Sha256`. Constant-time compare. */
export function signShopifyBody(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}
export function verifyShopifyHmac(rawBody: Buffer | string, header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const a = Buffer.from(signShopifyBody(rawBody, secret)); const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
