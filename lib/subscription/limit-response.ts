import { NextResponse } from 'next/server';
import { checkLimit } from '@/lib/subscription';
import type { LimitCheckType } from '@/lib/subscription/limit-registry';

/** Returns a 403 response when the usage limit is exceeded, otherwise null. */
export async function limitExceededResponse(
  businessId: string,
  limitType: LimitCheckType
): Promise<NextResponse | null> {
  const check = await checkLimit(businessId, limitType);
  if (!check.allowed) {
    return NextResponse.json(
      {
        error: check.message ?? 'Limit reached',
        code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
        limit: check.limit,
        current: check.current,
      },
      { status: 403 }
    );
  }
  return null;
}
