import { NextResponse } from 'next/server';
import { checkLimit } from '@/lib/subscription';
import type { LimitCheckType } from '@/lib/subscription/limit-registry';
import { LimitRefusedError } from '@/lib/subscription/limit-lock';

/** The standard 403 body for a limit check that did not pass (checkLimit or checkLimitInTransaction result). */
export function limitExceededReply(
  limitType: LimitCheckType,
  check: { limit: number; current: number; message?: string; unavailable?: boolean }
): NextResponse {
  if (check.unavailable) {
    // The limit could not be checked (not a plan limit): no upgrade prompt, just try again.
    return NextResponse.json(
      { error: check.message ?? 'Please try again in a moment.', code: 'LIMIT_CHECK_UNAVAILABLE', limit_type: limitType },
      { status: 503 }
    );
  }
  return NextResponse.json(
    {
      error: check.message ?? 'Limit reached',
      code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
      limit_type: limitType,
      limit: check.limit,
      current: check.current,
    },
    { status: 403 }
  );
}

/** Returns a 403 response when the usage limit is exceeded, otherwise null. */
export async function limitExceededResponse(
  businessId: string,
  limitType: LimitCheckType
): Promise<NextResponse | null> {
  const check = await checkLimit(businessId, limitType);
  if (!check.allowed) return limitExceededReply(limitType, check);
  return null;
}

/** The HTTP answer for a LimitRefusedError thrown by withLimitedCreate, or null for any other error. */
export function limitRefusedResponse(error: unknown): NextResponse | null {
  if (error instanceof LimitRefusedError) return limitExceededReply(error.limitType, error.check);
  return null;
}
