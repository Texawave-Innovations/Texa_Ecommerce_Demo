import { onRequest } from 'firebase-functions/v2/https';
import { REGION } from '../admin';
import { mapShiprocketStatus } from '../adapters/courier';
import { applyCourierEvent } from '../oms/fulfil';
import { OMS_SYSTEM } from '../oms/orders';
import { SHIPROCKET_WEBHOOK_TOKEN, SHOPIFY_WEBHOOK_SECRET, safeEqual, shiprocketToken, shopifySecret, verifyShopifyHmac } from './hmac';
import { ingestShopifyEvent } from './ingest';

/**
 * Shopify webhook endpoint. Order of operations (each step is a hard gate):
 *  1. POST only · 2. HMAC over the RAW body vs the Secret Manager secret (401 otherwise, nothing is read or stored)
 *  3. dedupe by X-Shopify-Event-Id (falls back to X-Shopify-Webhook-Id) · 4. process · 5. ALWAYS 200 once verified, so Shopify does not retry —
 *  our own failedEvents queue owns retries (exponential backoff, dead letter after 6 attempts).
 */
export const shopifyWebhook = onRequest({ region: REGION, secrets: [SHOPIFY_WEBHOOK_SECRET], cors: false, timeoutSeconds: 60, memory: '512MiB' }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  const secret = shopifySecret();
  if (!secret) { console.error('SHOPIFY_WEBHOOK_SECRET is not configured — refusing all webhooks'); res.status(500).send('Webhook secret not configured'); return; }
  const raw = req.rawBody;
  if (!raw || !verifyShopifyHmac(raw, req.get('x-shopify-hmac-sha256'), secret)) { res.status(401).send('Invalid signature'); return; }
  const id = req.get('x-shopify-event-id') ?? req.get('x-shopify-webhook-id');
  const topic = req.get('x-shopify-topic');
  if (!id || !topic) { res.status(400).send('Missing X-Shopify-Event-Id / X-Shopify-Topic'); return; }
  let payload: Record<string, any>;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { res.status(400).send('Body is not JSON'); return; }
  try {
    const r = await ingestShopifyEvent({ id, topic, shop: req.get('x-shopify-shop-domain') ?? 'unknown', payload });
    res.status(200).json({ ok: true, id, status: r.status });
  } catch (e) {
    // Only reachable if we could not even record the failure (Firestore down) → let Shopify retry.
    console.error('webhook infrastructure failure', e);
    res.status(500).send('Temporary failure');
  }
});

/** Shiprocket tracking webhook (static token header). Unknown statuses / illegal transitions are logged and acknowledged. */
export const courierWebhook = onRequest({ region: REGION, secrets: [SHIPROCKET_WEBHOOK_TOKEN], cors: false }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  const token = shiprocketToken();
  if (!token || !safeEqual(String(req.get('x-api-key') ?? ''), token)) { res.status(401).send('Invalid token'); return; }
  const b = req.body as { awb?: string; current_status?: string; reason?: string };
  const event = mapShiprocketStatus(b.current_status ?? '');
  if (!b.awb || !event) { res.status(200).json({ ok: true, ignored: true }); return; }
  try { res.status(200).json({ ok: true, ...(await applyCourierEvent(OMS_SYSTEM, { awb: b.awb, event, note: b.reason })) }); }
  catch (e) { console.warn('courier webhook not applied', (e as Error).message); res.status(200).json({ ok: true, ignored: true, reason: (e as Error).message }); }
});
