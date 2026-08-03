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

/** Basic WhatsApp: connect + transactional sends (plan feature, not addon). */
export async function assertWhatsAppBaseAccess(
  ctx: BusinessApiHandlerContext,
): Promise<NextResponse | null> {
  try {
    await assertFeatureAccess(ctx.businessId, WHATSAPP_BASE_FEATURE);
    return null;
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) {
      return NextResponse.json(
        {
          error:
            'WhatsApp integration is not available on your plan. Upgrade to connect WhatsApp.',
          code: error.toResponse().code,
          feature: WHATSAPP_BASE_FEATURE,
        },
        { status: 403 },
      );
    }
    throw error;
  }
}

/** Bot / CRM / inbox product (`whatsapp_bot` addon). */
export async function assertWhatsAppPremiumAddon(
  ctx: BusinessApiHandlerContext,
): Promise<NextResponse | null> {
  const hasAddon = await hasWhatsAppBotAddon(ctx.businessId);
  if (!hasAddon) {
    return NextResponse.json(
      {
        error:
          'WhatsApp Bot addon is required. Purchase the addon to unlock conversations, automation, and CRM.',
        code: 'WHATSAPP_BOT_ADDON_REQUIRED',
      },
      { status: 403 },
    );
  }
  return null;
}

/** Custom / bulk manual sends (`whatsapp_send_message` or bot addon). */
export async function assertWhatsAppManualAddon(
  ctx: BusinessApiHandlerContext,
): Promise<NextResponse | null> {
  const [hasBot, hasSend] = await Promise.all([
    hasWhatsAppBotAddon(ctx.businessId),
    hasWhatsAppSendMessageAddon(ctx.businessId),
  ]);
  if (hasBot || hasSend) {
    return null;
  }
  return NextResponse.json(
    {
      error:
        'WhatsApp Send Message addon is required for custom messaging. Invoice sends from billing work on Basic WhatsApp.',
      code: 'WHATSAPP_SEND_ADDON_REQUIRED',
    },
    { status: 403 },
  );
}

export function isTransactionalWhatsAppSend(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const o = body as Record<string, unknown>;
  return Boolean(
    o.invoiceId ||
      o.estimateId ||
      o.creditNoteId ||
      o.salesOrderId ||
      o.transactional === true,
  );
}
