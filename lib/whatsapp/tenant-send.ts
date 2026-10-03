import {
  buildTemplateSendComponents,
  isMetaWaConfigured,
  sendTemplateMessage,
  uploadMedia,
} from '@/lib/meta-whatsapp';
import { toE164Digits } from '@/lib/platform-whatsapp-send';
import type { TenantWaEventKey, TenantWaFieldKey } from '@/lib/whatsapp/tenant-events';
import { resolveEventTemplate } from '@/lib/whatsapp/tenant-templates';

export type EventValues = Partial<Record<TenantWaFieldKey, string | number | null | undefined>>;

export type EventTemplateResult =
  | { sent: true; messageId: string; template: string }
  | { sent: false; reason: 'not_configured' | 'no_template' | 'invalid_phone' | 'failed'; error?: string };

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Sends the approved template the business chose for this event from its own Cloud API number.
 * Callers fall back to their QR text when this returns `sent: false`.
 */
export async function sendEventTemplate(input: {
  businessId: string;
  eventKey: TenantWaEventKey;
  to: string;
  values: EventValues;
  document?: { buffer: Buffer; filename: string };
}): Promise<EventTemplateResult> {
  const to = toE164Digits(input.to);
  if (!to) return { sent: false, reason: 'invalid_phone' };
  try {
    if (!(await isMetaWaConfigured(input.businessId))) return { sent: false, reason: 'not_configured' };
    const resolved = await resolveEventTemplate(input.businessId, input.eventKey);
    if (!resolved) return { sent: false, reason: 'no_template' };
    const { template, variableMap } = resolved;

    let doc: { mediaId: string; filename: string } | undefined;
    if (template.header_format === 'document') {
      if (!input.document) {
        return { sent: false, reason: 'failed', error: `Template ${template.name} needs a document but none was given` };
      }
      const mediaId = await uploadMedia({
        businessId: input.businessId,
        buffer: input.document.buffer,
        mimeType: 'application/pdf',
        filename: input.document.filename,
      });
      doc = { mediaId, filename: input.document.filename };
    } else if (['image', 'video'].includes(template.header_format)) {
      return { sent: false, reason: 'failed', error: `Template ${template.name} has a media header Khatario can't fill` };
    }

    const values = variableMap.map((k) => {
      const v = input.values[k as TenantWaFieldKey];
      return v == null ? '' : String(v);
    });
    const { messageId } = await sendTemplateMessage({
      businessId: input.businessId,
      to,
      name: template.name,
      language: template.language,
      components: buildTemplateSendComponents(template, values, doc),
    });
    return { sent: true, messageId, template: template.name };
  } catch (err) {
    const error = errMessage(err);
    console.warn(`[wa event] ${input.eventKey} template send failed for business ${input.businessId}: ${error}`);
    return { sent: false, reason: 'failed', error };
  }
}

/**
 * Chosen Cloud template first, then the QR session with plain text. Errors are logged, not thrown,
 * because these are side notifications of an order or enquiry that already succeeded.
 */
export async function notifyBusinessEvent(input: {
  businessId: string;
  eventKey: TenantWaEventKey;
  to: string;
  values: EventValues;
  fallbackText: string;
}): Promise<{ via: 'cloud' | 'qr' | null }> {
  const res = await sendEventTemplate(input);
  if (res.sent) return { via: 'cloud' };
  const to = toE164Digits(input.to);
  if (!to) return { via: null };
  try {
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp');
    await sendWhatsAppMessage(input.businessId, to, input.fallbackText, undefined, 'text');
    return { via: 'qr' };
  } catch (err) {
    console.error(`[wa event] ${input.eventKey} not delivered for business ${input.businessId}:`, errMessage(err));
    return { via: null };
  }
}
