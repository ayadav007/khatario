import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { getBusinessSubscription } from '@/lib/subscription';
import { isTrialPlanId } from '@/lib/subscription/trial-plan';
import { canSeeBusinessData } from '@/lib/insights/turn';
import { rateLimited, readChatBody, streamAnswer } from '@/lib/rag/http';
import { isChannelEnabled } from '@/lib/rag/settings';

export const dynamic = 'force-dynamic';

/** Trial businesses use the `trial_app` channel, everyone else `in_app`; each has its own on/off switch. */
async function inAppChannel(businessId: string): Promise<'trial_app' | 'in_app' | null> {
  const sub = await getBusinessSubscription(businessId).catch(() => null);
  const channel = sub && (sub.status === 'trial' || isTrialPlanId(sub.plan_id)) ? 'trial_app' : 'in_app';
  return (await isChannelEnabled(channel)) ? channel : null;
}

export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return NextResponse.json({ enabled: false });
  const channel = await inAppChannel(auth.businessId);
  if (!channel) return NextResponse.json({ enabled: false });
  const owner = await canSeeBusinessData(auth.userId, auth.businessId).catch(() => false);
  return NextResponse.json({ enabled: true, channel, owner });
}

export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  const channel = await inAppChannel(auth.businessId);
  if (!channel) {
    return NextResponse.json({ error: 'The assistant is switched off right now.' }, { status: 403 });
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
    channel,
    audience: 'tenant_user',
    userId: auth.userId,
    businessId: auth.businessId,
  });
}
