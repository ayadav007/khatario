import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getCandidatePortalInviteEmailSettings,
  updateCandidatePortalInviteEmailSettings,
  resetCandidatePortalInviteEmailSettings,
  inviteEmailPlaceholderHint,
} from '@/lib/hr/recruitment/onboarding/invite-email-settings';
import { buildInviteEmailPreview } from '@/lib/hr/recruitment/onboarding/invite-email';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'read', { businessId });

    const settings = await getCandidatePortalInviteEmailSettings(businessId);
    const preview = buildInviteEmailPreview(settings);

    return NextResponse.json({
      settings,
      placeholders: inviteEmailPlaceholderHint(),
      preview,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[onboarding-invite-email GET]', error);
    return NextResponse.json({ error: 'Failed to load email settings' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'update', { businessId });

    const body = await request.json();

    if (body?.action === 'reset_defaults') {
      const settings = await resetCandidatePortalInviteEmailSettings(businessId);
      const preview = buildInviteEmailPreview(settings);
      return NextResponse.json({ settings, preview });
    }

    const patch: Record<string, unknown> = {};
    const allowed = [
      'subject',
      'intro_html',
      'footer_html',
      'cta_label',
      'include_task_table',
      'include_login_steps',
      'login_steps_html',
    ] as const;
    for (const key of allowed) {
      if (body[key] !== undefined) patch[key] = body[key];
    }

    const settings = await updateCandidatePortalInviteEmailSettings(businessId, patch);
    const preview = buildInviteEmailPreview(settings);
    return NextResponse.json({ settings, preview });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[onboarding-invite-email PATCH]', error);
    return NextResponse.json({ error: 'Failed to update email settings' }, { status: 500 });
  }
}
