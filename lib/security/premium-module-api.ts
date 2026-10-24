import { NextResponse } from 'next/server';
import { getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { withBusinessApi } from './with-business-api';
import type {
  BusinessApiClaimedBusinessInput,
  BusinessApiHandlerContext,
  WithBusinessApiOptions,
} from './types';
import type { BusinessApiHandler } from './types';
import {
  assertWhatsAppBaseAccess,
  assertWhatsAppInboxPermission,
  assertWhatsAppManagePermission,
  assertWhatsAppPremiumAddon,
  assertNotConnectAgentWrite,
  type WhatsAppInboxAction,
} from './whatsapp-api-gates';
export {
  assertWhatsAppBaseAccess,
  assertWhatsAppInboxPermission,
  assertWhatsAppManagePermission,
  WHATSAPP_MANAGE_PERMISSION_MODULE,
  assertWhatsAppManualAddon,
  assertWhatsAppPremiumAddon,
  WHATSAPP_INBOX_PERMISSION_MODULE,
  isTransactionalWhatsAppSend,
  WHATSAPP_BASE_FEATURE,
} from './whatsapp-api-gates';

/** Resolve tenant claim from JSON body or query string (legacy pattern). */
export function businessIdFromQueryOrBody(
  input: BusinessApiClaimedBusinessInput,
): string | null {
  if (input.body != null && typeof input.body === 'object') {
    const fromBody = (input.body as { business_id?: string }).business_id;
    if (fromBody) return fromBody;
  }
  const fromQuery = new URL(input.request.url).searchParams.get('business_id');
  if (fromQuery) return fromQuery;
  return getBusinessIdFromRequest(input.request, input.body);
}

/** Subscription + tenant gate for premium modules; RBAC/feature checks stay in handlers when omitted. */
export function withPremiumSubscriptionApi<
  TParams extends Record<string, string> = Record<string, string>,
>(
  options: WithBusinessApiOptions<TParams>,
  handler: (ctx: BusinessApiHandlerContext<TParams>) => Promise<NextResponse>,
): BusinessApiHandler<TParams> {
  return withBusinessApi(
    {
      claimedBusinessId: businessIdFromQueryOrBody,
      ...options,
    },
    handler,
  );
}

export type WhatsAppPremiumApiOptions<TParams extends Record<string, string>> = Omit<
  WithBusinessApiOptions<TParams>,
  'afterSubscription'
> & {
  /**
   * Require the "WhatsApp Chats" role permission. `true` maps the HTTP method to
   * read/create/update/delete; pass an action to override (e.g. `'export'`).
   */
  inboxPermission?: true | WhatsAppInboxAction;
  /** Require the "WhatsApp setup & campaigns" role permission (same value rules as `inboxPermission`). */
  managePermission?: true | WhatsAppInboxAction;
};

/** WhatsApp Bot / CRM / inbox routes. */
export function withWhatsAppPremiumApi<
  TParams extends Record<string, string> = Record<string, string>,
>(
  options: WhatsAppPremiumApiOptions<TParams> = {},
  handler: (ctx: BusinessApiHandlerContext<TParams>) => Promise<NextResponse>,
): BusinessApiHandler<TParams> {
  const { inboxPermission, managePermission, ...rest } = options;
  return withPremiumSubscriptionApi(
    {
      ...rest,
      afterSubscription: async (ctx) => {
        const denied = await assertWhatsAppPremiumAddon(ctx);
        if (denied) return denied;
        if (inboxPermission) {
          const inboxDenied = await assertWhatsAppInboxPermission(
            ctx,
            inboxPermission === true ? undefined : inboxPermission,
          );
          if (inboxDenied) return inboxDenied;
        }
        if (managePermission) {
          return assertWhatsAppManagePermission(
            ctx,
            managePermission === true ? undefined : managePermission,
          );
        }
        return null;
      },
    },
    handler,
  );
}

/** QR link + status + invoice sends and manual reminders (`settings_whatsapp` plan feature). */
export function withWhatsAppBaseApi<
  TParams extends Record<string, string> = Record<string, string>,
>(
  options: Omit<WithBusinessApiOptions<TParams>, 'afterSubscription'> = {},
  handler: (ctx: BusinessApiHandlerContext<TParams>) => Promise<NextResponse>,
): BusinessApiHandler<TParams> {
  return withPremiumSubscriptionApi(
    {
      ...options,
      afterSubscription: async (ctx) =>
        (await assertWhatsAppBaseAccess(ctx)) ?? assertNotConnectAgentWrite(ctx),
    },
    handler,
  );
}
