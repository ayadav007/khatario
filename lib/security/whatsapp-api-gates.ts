import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { checkUserPermission } from '@/lib/permissions';
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

export const WHATSAPP_INBOX_PERMISSION_MODULE = 'whatsapp_inbox';

export type WhatsAppInboxAction = 'read' | 'create' | 'update' | 'delete' | 'export';

export function inboxActionForMethod(method: string): WhatsAppInboxAction {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return 'read';
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return 'create';
  }
}

/** Bot rules, campaigns, groups, dashboards and Connect setup. */
export const WHATSAPP_MANAGE_PERMISSION_MODULE = 'whatsapp';

async function assertWhatsAppModulePermission(
  ctx: Pick<BusinessApiHandlerContext, 'userId'>,
  moduleKey: string,
  action: WhatsAppInboxAction,
  error: string,
): Promise<NextResponse | null> {
  const user = await queryOne<{ is_primary_admin: boolean }>(
    'SELECT is_primary_admin FROM users WHERE id = $1',
    [ctx.userId],
  );
  if (user?.is_primary_admin) return null;

  if (await checkUserPermission(ctx.userId, moduleKey, action)) return null;

  return NextResponse.json(
    { error, code: 'PERMISSION_DENIED', module: moduleKey, action },
    { status: 403 },
  );
}

/** Role gate for chat content ("WhatsApp Chats" permission). The primary admin always passes. */
export function assertWhatsAppInboxPermission(
  ctx: Pick<BusinessApiHandlerContext, 'request' | 'userId'>,
  action: WhatsAppInboxAction = inboxActionForMethod(ctx.request.method),
): Promise<NextResponse | null> {
  return assertWhatsAppModulePermission(
    ctx,
    WHATSAPP_INBOX_PERMISSION_MODULE,
    action,
    'Your role does not have access to WhatsApp chats. Ask the business owner to enable "WhatsApp Chats" for your role.',
  );
}

/** Role gate for "WhatsApp setup & campaigns". The primary admin always passes. */
export function assertWhatsAppManagePermission(
  ctx: Pick<BusinessApiHandlerContext, 'request' | 'userId'>,
  action: WhatsAppInboxAction = inboxActionForMethod(ctx.request.method),
): Promise<NextResponse | null> {
  return assertWhatsAppModulePermission(
    ctx,
    WHATSAPP_MANAGE_PERMISSION_MODULE,
    action,
    'Your role does not have access to WhatsApp setup and campaigns. Ask the business owner to enable "WhatsApp setup & campaigns" for your role.',
  );
}

/** QR link, disconnect and reminder sends are owner/staff actions; Connect agents only chat. */
export async function assertNotConnectAgentWrite(
  ctx: Pick<BusinessApiHandlerContext, 'request' | 'userId'>,
): Promise<NextResponse | null> {
  const method = ctx.request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return null;
  const user = await queryOne<{ seat_type: string | null }>(
    `SELECT to_jsonb(u)->>'seat_type' AS seat_type FROM users u WHERE u.id = $1`,
    [ctx.userId],
  );
  if (user?.seat_type !== 'connect') return null;
  return NextResponse.json(
    {
      error: 'WhatsApp agents can chat with customers but cannot change the WhatsApp connection or send reminders.',
      code: 'PERMISSION_DENIED',
      module: WHATSAPP_MANAGE_PERMISSION_MODULE,
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
