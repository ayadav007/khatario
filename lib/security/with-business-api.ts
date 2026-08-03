import { NextRequest, NextResponse } from 'next/server';
import {
  assertSessionValidForCookieAuth,
  getUserIdFromRequest,
  requireTenantBusinessId,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import {
  assertFeatureAccess,
  assertReportAccess,
  FeatureAccessDeniedError,
} from '@/lib/subscription/feature-access';
import {
  operationalSubscriptionErrorResponse,
  requireOperationalSubscription,
} from './require-operational-subscription';
import type {
  BusinessApiHandler,
  BusinessApiHandlerContext,
  BusinessApiRouteContext,
  WithBusinessApiOptions,
} from './types';

async function resolveRouteParams<TParams extends Record<string, string>>(
  routeContext?: BusinessApiRouteContext<TParams>,
): Promise<TParams> {
  const raw = routeContext?.params;
  if (!raw) {
    return {} as TParams;
  }
  return (typeof (raw as Promise<TParams>).then === 'function'
    ? await raw
    : raw) as TParams;
}

function resolveClaimedBusinessId<TParams extends Record<string, string>>(
  options: WithBusinessApiOptions<TParams>,
  request: NextRequest,
  params: TParams,
  body: unknown | null,
): string | null | undefined {
  const { claimedBusinessId } = options;
  if (typeof claimedBusinessId === 'function') {
    return claimedBusinessId({ request, params, body });
  }
  return claimedBusinessId;
}

function mapHandlerError(error: unknown): NextResponse {
  return (
    operationalSubscriptionErrorResponse(error) ??
    enforceAccessErrorResponse(error) ??
    (error instanceof AuthorizationError ? error.toNextResponse() : null) ??
    (error instanceof FeatureAccessDeniedError ? error.toNextResponse() : null) ??
    NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  );
}

/**
 * Higher-order route wrapper for tenant-scoped business APIs.
 *
 * Runs, in order: JWT tenant binding → user id → operational subscription → RBAC →
 * optional feature/report gate → optional plan limits / branch access.
 *
 * Does not replace existing routes until migrated; composes current helpers only.
 */
export function withBusinessApi<
  TParams extends Record<string, string> = Record<string, string>,
>(
  options: WithBusinessApiOptions<TParams>,
  handler: (ctx: BusinessApiHandlerContext<TParams>) => Promise<NextResponse>,
): BusinessApiHandler<TParams> {
  return async (request: NextRequest, routeContext?: BusinessApiRouteContext<TParams>) => {
    try {
      const params = await resolveRouteParams(routeContext);

      let body: unknown | null = null;
      if (options.parseJsonBody) {
        try {
          body = await request.json();
        } catch {
          body = null;
        }
      }

      const claimed = resolveClaimedBusinessId(options, request, params, body);
      const tenant = requireTenantBusinessId(request, claimed);
      if (!tenant.ok) {
        return tenant.response;
      }

      const sessionUserId = getUserIdFromRequest(
        request,
        body != null && typeof body === 'object'
          ? (body as Record<string, unknown>)
          : undefined,
      );
      if (!sessionUserId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }

      const actingUserId =
        options.resolveActingUserId?.({
          request,
          params,
          body,
          sessionUserId,
        }) ?? sessionUserId;

      if (!actingUserId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }

      await assertSessionValidForCookieAuth(actingUserId);

      const subscription = await requireOperationalSubscription(tenant.businessId);

      const handlerCtx: BusinessApiHandlerContext<TParams> = {
        request,
        params,
        body,
        businessId: tenant.businessId,
        userId: actingUserId,
        subscription,
      };

      if (options.afterSubscription) {
        const blocked = await options.afterSubscription(handlerCtx);
        if (blocked) {
          return blocked;
        }
      }

      if (options.module) {
        if (!options.action) {
          throw new Error('withBusinessApi: action is required when module is set');
        }
        await authorize(actingUserId, options.module, options.action, {
          businessId: tenant.businessId,
          branchId: options.branchId ?? options.authContext?.branchId,
          warehouseId: options.authContext?.warehouseId,
          resourceId: options.authContext?.resourceId,
          ...options.authContext,
        });
      }

      if (options.report) {
        await assertReportAccess(tenant.businessId, options.report);
      } else if (options.feature) {
        await assertFeatureAccess(tenant.businessId, options.feature);
      }

      if (options.limitType || options.branchId) {
        await enforceAccess({
          businessId: tenant.businessId,
          userId: actingUserId,
          limitType: options.limitType,
          branchId: options.branchId,
          branchPermission: options.branchPermission,
        });
      }

      return handler(handlerCtx);
    } catch (error) {
      return mapHandlerError(error);
    }
  };
}
