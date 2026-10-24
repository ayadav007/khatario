import {
  buildGraphComponents,
  createMessageTemplate,
  isMetaWaConfigured,
  listMessageTemplates,
  mapMetaStatus,
  sendTemplateMessage,
  type GraphComponent,
} from '@/lib/meta-whatsapp';
import { sendPlatformEventWhatsApp, toE164Digits } from '@/lib/platform-whatsapp-send';
import { notifyBusinessEvent, sendEventTemplate, type EventValues } from '@/lib/whatsapp/tenant-send';

/** Authentication template created on the merchant's own WhatsApp Business Account. */
export const STORE_OTP_TEMPLATE = 'store_login_code';
const STORE_OTP_LANGUAGE = 'en_US';

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function notifyStoreCustomerWhatsApp(input: {
  businessId: string;
  phone: string;
  text: string;
}): Promise<void> {
  const to = toE164Digits(input.phone);
  if (!to) return;
  try {
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp');
    await sendWhatsAppMessage(input.businessId, to, input.text, undefined, 'text');
  } catch (err) {
    console.error('[store whatsapp]', err);
  }
}

/** Store message to a shopper: the merchant's chosen Meta template, else plain text over QR. */
export async function notifyStoreEvent(input: {
  businessId: string;
  eventKey: 'store_order_placed' | 'store_order_paid' | 'store_order_shipped';
  phone: string;
  values: EventValues;
  text: string;
}): Promise<void> {
  await notifyBusinessEvent({
    businessId: input.businessId,
    eventKey: input.eventKey,
    to: input.phone,
    values: input.values,
    fallbackText: input.text,
  });
}

function otpSendComponents(code: string): GraphComponent[] {
  return [
    { type: 'body', parameters: [{ type: 'text', text: code }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
  ];
}

function isMissingTemplateError(err: unknown): boolean {
  return /132001|does not exist/i.test(errMessage(err));
}

async function ensureStoreOtpTemplate(businessId: string): Promise<string> {
  try {
    const created = await createMessageTemplate({
      businessId,
      name: STORE_OTP_TEMPLATE,
      language: STORE_OTP_LANGUAGE,
      category: 'AUTHENTICATION',
      components: buildGraphComponents({ category: 'AUTHENTICATION', bodyText: '', exampleVars: [] }),
    });
    return mapMetaStatus(created.status);
  } catch (err) {
    if (!/already exists|duplicate/i.test(errMessage(err))) throw err;
    const t = (await listMessageTemplates(businessId)).find(
      (x) => x.name === STORE_OTP_TEMPLATE && (!x.language || x.language === STORE_OTP_LANGUAGE),
    );
    return t ? mapMetaStatus(t.status) : 'missing';
  }
}

/**
 * Meta drops free-form text to customers who have not messaged the number in the last 24 hours,
 * so codes over Cloud API go through an approved authentication template, created on first use.
 */
async function sendOtpViaCloud(businessId: string, to: string, code: string): Promise<void> {
  const send = () =>
    sendTemplateMessage({
      businessId,
      to,
      name: STORE_OTP_TEMPLATE,
      language: STORE_OTP_LANGUAGE,
      components: otpSendComponents(code),
    });
  try {
    await send();
  } catch (err) {
    if (!isMissingTemplateError(err)) throw err;
    const status = await ensureStoreOtpTemplate(businessId);
    if (status !== 'approved') throw new Error(`Login code template "${STORE_OTP_TEMPLATE}" is ${status} on Meta`);
    await send();
  }
}

export type StoreOtpDelivery =
  | { sent: true; via: 'cloud' | 'qr' | 'platform' }
  | { sent: false; reason: string };

/** Merchant's Cloud API number, then its QR session, then the platform number. */
export async function sendStoreOtpWhatsApp(input: {
  businessId: string;
  storeName: string;
  phone: string;
  code: string;
}): Promise<StoreOtpDelivery> {
  const to = toE164Digits(input.phone);
  if (!to) return { sent: false, reason: 'INVALID_PHONE' };
  const failures: string[] = [];

  if (await isMetaWaConfigured(input.businessId).catch(() => false)) {
    const chosen = await sendEventTemplate({
      businessId: input.businessId,
      eventKey: 'store_otp',
      to,
      values: { code: input.code },
    });
    if (chosen.sent) return { sent: true, via: 'cloud' };
    if (chosen.reason !== 'no_template') failures.push(`chosen template: ${chosen.error ?? chosen.reason}`);
    try {
      await sendOtpViaCloud(input.businessId, to, input.code);
      return { sent: true, via: 'cloud' };
    } catch (err) {
      failures.push(`cloud: ${errMessage(err)}`);
    }
  }

  try {
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp');
    await sendWhatsAppMessage(
      input.businessId,
      to,
      `Your ${input.storeName} verification code is ${input.code}. It expires in 10 minutes.`,
      undefined,
      'text',
    );
    return { sent: true, via: 'qr' };
  } catch (err) {
    failures.push(`qr: ${errMessage(err)}`);
  }

  try {
    const platform = await sendPlatformEventWhatsApp({ eventKey: 'signup_otp', toPhone: to, vars: [input.code] });
    if (platform.sent) return { sent: true, via: 'platform' };
    failures.push(`platform: ${platform.skipped}`);
  } catch (err) {
    failures.push(`platform: ${errMessage(err)}`);
  }

  const reason = failures.join(' | ');
  console.warn(`[store otp] not delivered for business ${input.businessId}: ${reason}`);
  return { sent: false, reason };
}
