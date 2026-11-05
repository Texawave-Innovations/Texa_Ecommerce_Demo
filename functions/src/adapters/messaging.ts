import { FieldValue, col } from '../admin';

/** Messaging adapter (rule 10). The real WhatsApp Business / SMS provider plugs in behind this interface. */
export interface OutboundMessage { channel: 'whatsapp' | 'sms'; to: string; body: string; refType?: string; refId?: string }
export interface MessagingAdapter { send(m: OutboundMessage): Promise<{ status: string }> }

export class MockWhatsApp implements MessagingAdapter {
  async send(m: OutboundMessage) {
    const status = 'sent (mock)';
    await col('messageLog').add({ ...m, status, at: FieldValue.serverTimestamp() });
    return { status };
  }
}
export const messaging: MessagingAdapter = new MockWhatsApp();
