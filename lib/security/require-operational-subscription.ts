import { NextResponse } from 'next/server';
import { isBusinessPlatformSuspended } from '@/lib/admin-business-ops';
import {
  getBusinessSubscription,
  isSubscriptionOperationalStatus,
  type BusinessSubscription,
} from '@/lib/subscription';
import { checkTrialExpiry } from '@/lib/subscription/lifecycle';
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
 * Allows: `active`, non-expired `trial`.
 * Denies: missing subscription, `expired`, `cancelled`, platform-suspended,
 * calendar-expired trial, past `end_date`.
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

  const subscription = await getBusinessSubscription(businessId, true);
  if (!subscription) {
    throw new OperationalSubscriptionError(
      403,
      'NO_SUBSCRIPTION',
      'No active subscription for this business.',
    );
  }

  if (!isSubscriptionOperationalStatus(subscription.status)) {
    const code: OperationalSubscriptionDeniedCode =
      subscription.status === 'expired'
        ? 'SUBSCRIPTION_EXPIRED'
        : subscription.status === 'cancelled'
          ? 'SUBSCRIPTION_CANCELLED'
          : 'SUBSCRIPTION_INACTIVE';
    throw new OperationalSubscriptionError(
      403,
      code,
      `Subscription status is ${subscription.status}.`,
    );
  }

  if (subscription.status === 'trial') {
    const trialInfo = await checkTrialExpiry(businessId);
    if (trialInfo.isExpired && !trialInfo.isInGracePeriod) {
      throw new OperationalSubscriptionError(
        403,
        'TRIAL_EXPIRED',
        'Trial period has expired.',
      );
    }
  }

  if (subscription.end_date) {
    const endDate = new Date(subscription.end_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (endDate < today) {
      throw new OperationalSubscriptionError(
        403,
        'SUBSCRIPTION_EXPIRED',
        'Subscription has expired.',
      );
    }
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
