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
  assertWhatsAppPremiumAddon,
} from './whatsapp-api-gates';

export {
  assertWhatsAppBaseAccess,
  assertWhatsAppManualAddon,
  assertWhatsAppPremiumAddon,
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

/** WhatsApp Bot / CRM / inbox routes. */
export function withWhatsAppPremiumApi<
  TParams extends Record<string, string> = Record<string, string>,
>(
  options: Omit<WithBusinessApiOptions<TParams>, 'afterSubscription'> = {},
  handler: (ctx: BusinessApiHandlerContext<TParams>) => Promise<NextResponse>,
): BusinessApiHandler<TParams> {
  return withPremiumSubscriptionApi(
    {
      ...options,
      afterSubscription: assertWhatsAppPremiumAddon,
    },
    handler,
  );
}

/** Connect + status + transactional billing sends (`settings_whatsapp` plan feature). */
export function withWhatsAppBaseApi<
  TParams extends Record<string, string> = Record<string, string>,
>(
  options: Omit<WithBusinessApiOptions<TParams>, 'afterSubscription'> = {},
  handler: (ctx: BusinessApiHandlerContext<TParams>) => Promise<NextResponse>,
): BusinessApiHandler<TParams> {
  return withPremiumSubscriptionApi(
    {
      ...options,
      afterSubscription: assertWhatsAppBaseAccess,
    },
    handler,
  );
}
