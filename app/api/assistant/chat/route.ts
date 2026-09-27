import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { getBusinessSubscription } from '@/lib/subscription';
import { isTrialPlanId } from '@/lib/subscription/trial-plan';
import { rateLimited, readChatBody, streamAnswer } from '@/lib/rag/http';
import { isChannelEnabled } from '@/lib/rag/settings';

export const dynamic = 'force-dynamic';

/** Phase 1: the in-app help assistant is offered to businesses on a trial plan. */
async function inAppAllowed(businessId: string): Promise<boolean> {
  if (!(await isChannelEnabled('trial_app'))) return false;
  const sub = await getBusinessSubscription(businessId).catch(() => null);
  return Boolean(sub && (sub.status === 'trial' || isTrialPlanId(sub.plan_id)));
}

export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return NextResponse.json({ enabled: false });
  return NextResponse.json({ enabled: await inAppAllowed(auth.businessId), channel: 'trial_app' });
}

export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  if (!(await inAppAllowed(auth.businessId))) {
    return NextResponse.json({ error: 'The assistant is not available on your plan yet.' }, { status: 403 });
  }
  const limited = rateLimited([
    [`assistant:user:min:${auth.userId}`, 15, 60_000],
    [`assistant:business:day:${auth.businessId}`, 400, 86_400_000],
  ]);
  if (limited) return limited;

  const body = await readChatBody(request);
  if (body instanceof NextResponse) return body;

  return streamAnswer(request, {
    message: body.message,
    conversationId: body.conversationId,
    pagePath: body.pagePath,
    channel: 'trial_app',
    audience: 'tenant_user',
    userId: auth.userId,
    businessId: auth.businessId,
  });
}
