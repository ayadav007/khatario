import { NextResponse } from 'next/server';
import { isBusinessPlatformSuspended } from '@/lib/admin-business-ops';
import {
  getBusinessSubscription,
  isSubscriptionOperationalStatus,
  type BusinessSubscription,
} from '@/lib/subscription';
import {
  getOperationalModuleSubscriptions,
  getPrimaryModuleSubscription,
} from '@/lib/subscription/module-subscriptions';
import type { OperationalSubscriptionDeniedCode } from './types';

export class OperationalSubscriptionError extends Error {
  constructor(
    public statusCode: number,
    public code: OperationalSubscriptionDeniedCode,
    message: string,
  ) {
    super(message);
    this.name = 'OperationalSubscriptionError';
  }
}

/**
 * Ensures a business may use operational APIs.
 *
 * Allows: `active` (including paid grace after `end_date`) and `trial`. A calendar-expired
 * trial stays usable on Free-plan entitlements until the owner extends or picks Free.
 * Denies: missing subscription, `expired`, `cancelled`, platform-suspended, past `end_date`
 * with no grace left.
 *
 * Throws {@link OperationalSubscriptionError} on denial; returns the subscription row on success.
 */
export async function requireOperationalSubscription(
  businessId: string,
): Promise<BusinessSubscription> {
  if (!businessId?.trim()) {
    throw new OperationalSubscriptionError(
      403,
      'NO_SUBSCRIPTION',
      'No active subscription for this business.',
    );
  }

  if (await isBusinessPlatformSuspended(businessId)) {
    throw new OperationalSubscriptionError(
      403,
      'BUSINESS_SUSPENDED',
      'This business account is suspended.',
    );
  }

  const operational = await getOperationalModuleSubscriptions(businessId, true);
  const primary = await getPrimaryModuleSubscription(businessId, true);
  if (operational.length === 0) {
    if (!primary) {
      throw new OperationalSubscriptionError(
        403,
        'NO_SUBSCRIPTION',
        'No active subscription for this business.',
      );
    }
    if (!isSubscriptionOperationalStatus(primary.status)) {
      const code: OperationalSubscriptionDeniedCode =
        primary.status === 'expired'
          ? 'SUBSCRIPTION_EXPIRED'
          : primary.status === 'cancelled'
            ? 'SUBSCRIPTION_CANCELLED'
            : 'SUBSCRIPTION_INACTIVE';
      throw new OperationalSubscriptionError(403, code, `Subscription status is ${primary.status}.`);
    }
    throw new OperationalSubscriptionError(403, 'SUBSCRIPTION_EXPIRED', 'Subscription has expired.');
  }

  const row = operational.find((r) => r.module_key === primary?.module_key) ?? operational[0];
  const subscription = await getBusinessSubscription(businessId, true, row.module_key);
  if (!subscription) {
    throw new OperationalSubscriptionError(
      403,
      'NO_SUBSCRIPTION',
      'No active subscription for this business.',
    );
  }
  return subscription;
}

/** Map {@link OperationalSubscriptionError} to a JSON response, or `null` for other errors. */
export function operationalSubscriptionErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof OperationalSubscriptionError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode },
    );
  }
  return null;
}

/** Non-throwing variant for handlers that prefer early-return responses. */
export async function assertOperationalSubscription(
  businessId: string,
): Promise<
  | { ok: true; subscription: BusinessSubscription }
  | { ok: false; response: NextResponse }
> {
  try {
    const subscription = await requireOperationalSubscription(businessId);
    return { ok: true, subscription };
  } catch (error) {
    const response = operationalSubscriptionErrorResponse(error);
    if (response) {
      return { ok: false, response };
    }
    throw error;
  }
}
