import { NextResponse } from 'next/server';
import { checkLimit } from '@/lib/subscription';
import type { LimitCheckType } from '@/lib/subscription/limit-registry';

/** The standard 403 body for a limit check that did not pass (checkLimit or checkLimitInTransaction result). */
export function limitExceededReply(
  limitType: LimitCheckType,
  check: { limit: number; current: number; message?: string }
): NextResponse {
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
