import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { sendCandidatePortalInvite } from '@/lib/hr/recruitment/onboarding/send-portal-invite';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'recruitment', 'update', { businessId, resourceId: params.id });

    const body = await request.json().catch(() => ({}));
    const templateIds = Array.isArray(body?.template_ids)
      ? body.template_ids.map(String).filter(Boolean)
      : undefined;

    const result = await sendCandidatePortalInvite({
      businessId,
      candidateId: params.id,
      templateIds,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Failed to invite candidate';
    console.error('[invite-portal]', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
