import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { listOnboardingTemplates, resetOnboardingTemplatesToDefaults } from '@/lib/hr/recruitment/onboarding/template-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'read', { businessId });

    const templates = await listOnboardingTemplates(businessId);
    return NextResponse.json({ templates });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[onboarding-templates GET]', error);
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'update', { businessId });

    const body = await request.json();
    if (body?.action !== 'reset_defaults') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

    const templates = await resetOnboardingTemplatesToDefaults(businessId);
    return NextResponse.json({ templates });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[onboarding-templates POST]', error);
    return NextResponse.json({ error: 'Failed to reset templates' }, { status: 500 });
  }
}
