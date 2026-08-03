import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { updateOnboardingTemplate } from '@/lib/hr/recruitment/onboarding/template-service';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'update', { businessId });

    const body = await request.json();
    const patch: Record<string, unknown> = {};

    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.instruction_text !== undefined) patch.instruction_text = String(body.instruction_text);
    if (body.due_days_after_invite !== undefined) {
      const n = body.due_days_after_invite === null || body.due_days_after_invite === ''
        ? null
        : Number(body.due_days_after_invite);
      patch.due_days_after_invite = n;
    }
    if (body.is_required !== undefined) patch.is_required = Boolean(body.is_required);
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
    if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order);

    const updated = await updateOnboardingTemplate(businessId, params.id, patch);
    if (!updated) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

    return NextResponse.json({ template: updated });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[onboarding-templates PATCH]', error);
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 });
  }
}
