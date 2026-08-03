import type { NextRequest, NextResponse } from 'next/server';
import type { AuthorizationContext } from '@/lib/authorization';
import type { BusinessSubscription, LimitCheckType } from '@/lib/subscription';

/** Subscription states that block normal API operation. */
export type OperationalSubscriptionDeniedCode =
  | 'NO_SUBSCRIPTION'
  | 'SUBSCRIPTION_INACTIVE'
  | 'SUBSCRIPTION_EXPIRED'
  | 'SUBSCRIPTION_CANCELLED'
  | 'TRIAL_EXPIRED'
  | 'BUSINESS_SUSPENDED';

export type AuthModuleAction =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'export'
  | 'finalize'
  | 'cancel'
  | 'adjust_quantity'
  | 'adjust_value'
  | 'dispatch'
  | 'receive'
  | 'lock'
  | 'unlock'
  | 'approve';

export type ReportAccessCategory = 'basic' | 'gst' | 'advanced';

export interface BusinessApiClaimedBusinessInput<
  TParams extends Record<string, string> = Record<string, string>,
> {
  request: NextRequest;
  params: TParams;
  body: unknown | null;
}

export interface WithBusinessApiOptions<
  TParams extends Record<string, string> = Record<string, string>,
> {
  /** RBAC module key passed to {@link authorize}. Omit to keep RBAC in the route handler. */
  module?: string;
  /** RBAC action passed to {@link authorize}. Required when `module` is set. */
  action?: AuthModuleAction;
  /**
   * Client-supplied business id (body, query, or path) to validate against the JWT tenant.
   * When omitted, only the session tenant is used.
   */
  claimedBusinessId?:
    | string
    | null
    | ((input: BusinessApiClaimedBusinessInput<TParams>) => string | null | undefined);
  /** Parse JSON body once and expose it on the handler context (POST/PATCH). */
  parseJsonBody?: boolean;
  /** Feature registry key — runs {@link assertFeatureAccess}. */
  feature?: string;
  /** Report tier — runs {@link assertReportAccess}. Mutually exclusive with `feature`. */
  report?: ReportAccessCategory;
  /** Plan limit gate — runs {@link enforceAccess} limit branch only. */
  limitType?: LimitCheckType;
  branchId?: string | null;
  branchPermission?: 'view' | 'create_transactions';
  /** Extra context forwarded to {@link authorize}. */
  authContext?: Omit<AuthorizationContext, 'businessId' | 'branchId'>;
  /**
   * User id for RBAC / session checks. Defaults to session user from JWT.
   * Use for routes that authorize `created_by` from the body.
   */
  resolveActingUserId?: (
    input: BusinessApiClaimedBusinessInput<TParams> & { sessionUserId: string },
  ) => string | null | undefined;
  /** Runs after subscription is verified; return a response to abort the handler. */
  afterSubscription?: (
    ctx: BusinessApiHandlerContext<TParams>,
  ) => Promise<NextResponse | null | undefined | void>;
}

export interface BusinessApiHandlerContext<
  TParams extends Record<string, string> = Record<string, string>,
> {
  request: NextRequest;
  params: TParams;
  /** Parsed JSON body when `parseJsonBody: true`, otherwise `null`. */
  body: unknown | null;
  businessId: string;
  userId: string;
  subscription: BusinessSubscription;
}

export type BusinessApiRouteContext<TParams extends Record<string, string>> = {
  params: TParams | Promise<TParams>;
};

export type BusinessApiHandler<
  TParams extends Record<string, string> = Record<string, string>,
> = (
  request: NextRequest,
  routeContext?: BusinessApiRouteContext<TParams>,
) => Promise<Response>;
