import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import {
  getPlatformEmailTemplates,
  updatePlatformEmailTemplates,
  PLATFORM_TEMPLATE_DEFINITIONS,
} from '@/lib/platform-email-templates';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;

  const stored = await getPlatformEmailTemplates();
  return NextResponse.json({
    definitions: PLATFORM_TEMPLATE_DEFINITIONS,
    templates: stored,
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const templates = await updatePlatformEmailTemplates(body.templates || {});
    return NextResponse.json({ templates });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
