import { NextResponse } from 'next/server';
import {
  hasWhatsAppBotAddon,
  hasWhatsAppSendMessageAddon,
} from '@/lib/subscription';
import {
  assertFeatureAccess,
  FeatureAccessDeniedError,
} from '@/lib/subscription/feature-access';
import type { BusinessApiHandlerContext } from './types';

export const WHATSAPP_BASE_FEATURE = 'settings_whatsapp';

const CONNECT_ACTION_URL = '/settings/products';

/** WhatsApp ships with Billing (QR) and Connect; other products alone do not include it. */
async function hasNoWhatsAppProduct(businessId: string): Promise<boolean> {
  try {
    const { getBusinessPlatformContext } = await import('@/lib/business-modules');
    const { enabledModules } = await getBusinessPlatformContext(businessId);
    return !enabledModules.includes('billing') && !enabledModules.includes('connect');
  } catch {
    return false;
  }
}

/** Basic WhatsApp: QR link + invoice sends and reminders (every billing plan). */
export async function assertWhatsAppBaseAccess(
  ctx: BusinessApiHandlerContext,
): Promise<NextResponse | null> {
  try {
    await assertFeatureAccess(ctx.businessId, WHATSAPP_BASE_FEATURE);
    return null;
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) {
      const noProduct = await hasNoWhatsAppProduct(ctx.businessId);
      return NextResponse.json(
        {
          error: noProduct
            ? 'WhatsApp comes with Khatario Billing or Connect. Add one from Settings → Products.'
            : 'WhatsApp is not available on your plan right now. Check your subscription in Settings → Subscription.',
          code: noProduct ? 'MODULE_NOT_ENABLED' : error.toResponse().code,
          feature: WHATSAPP_BASE_FEATURE,
          ...(noProduct ? { action_url: CONNECT_ACTION_URL } : {}),
        },
        { status: 403 },
      );
    }
    throw error;
  }
}

/** Inbox, bot, AI agent, WABA, templates, shop (paid Connect plan). */
export async function assertWhatsAppPremiumAddon(
  ctx: Pick<BusinessApiHandlerContext, 'businessId'>,
): Promise<NextResponse | null> {
  if (await hasWhatsAppBotAddon(ctx.businessId)) return null;
  return NextResponse.json(
    {
      error:
        'This needs Khatario Connect. Connect adds the official WhatsApp API, shared inbox, AI agent, templates and automation.',
      code: 'WHATSAPP_BOT_ADDON_REQUIRED',
      module: 'connect',
      action_url: CONNECT_ACTION_URL,
    },
    { status: 403 },
  );
}

/** Custom and bulk sends beyond invoices and reminders (paid Connect plan). */
export async function assertWhatsAppManualAddon(
  ctx: BusinessApiHandlerContext,
): Promise<NextResponse | null> {
  if (await hasWhatsAppSendMessageAddon(ctx.businessId)) return null;
  return NextResponse.json(
    {
      error:
        'Custom and bulk WhatsApp messages need Khatario Connect. Invoice sends and payment reminders work on every plan.',
      code: 'WHATSAPP_SEND_ADDON_REQUIRED',
      module: 'connect',
      action_url: CONNECT_ACTION_URL,
    },
    { status: 403 },
  );
}

/**
 * Invoice sends ride the basic gate. Only `invoiceId` qualifies because the send route loads that
 * invoice scoped to the business (404 otherwise); other client flags were unverifiable.
 */
export function isTransactionalWhatsAppSend(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const o = body as Record<string, unknown>;
  return (
    (typeof o.invoiceId === 'string' && o.invoiceId.length > 0) || typeof o.invoiceId === 'number'
  );
}
