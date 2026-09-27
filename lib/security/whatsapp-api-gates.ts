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

async function isConnectModuleOff(businessId: string): Promise<boolean> {
  try {
    const { getBusinessPlatformContext } = await import('@/lib/business-modules');
    const ctx = await getBusinessPlatformContext(businessId);
    return !ctx.enabledModules.includes('connect');
  } catch {
    return false;
  }
}

/** Basic WhatsApp: connect + transactional sends (plan feature, not addon). */
export async function assertWhatsAppBaseAccess(
  ctx: BusinessApiHandlerContext,
): Promise<NextResponse | null> {
  try {
    await assertFeatureAccess(ctx.businessId, WHATSAPP_BASE_FEATURE);
    return null;
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) {
      const moduleOff = await isConnectModuleOff(ctx.businessId);
      return NextResponse.json(
        {
          error: moduleOff
            ? 'WhatsApp is part of Khatario Connect, which is not switched on for this business. Add Connect from Settings → Products.'
            : 'WhatsApp integration is not available on your plan. Upgrade to connect WhatsApp.',
          code: moduleOff ? 'MODULE_NOT_ENABLED' : error.toResponse().code,
          feature: WHATSAPP_BASE_FEATURE,
          ...(moduleOff ? { module: 'connect', action_url: '/settings/products' } : {}),
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
