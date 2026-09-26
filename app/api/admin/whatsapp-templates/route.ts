import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import {
  createPlatformWhatsAppDraft,
  listPlatformWhatsAppTemplates,
  metaWaSetupChecklist,
  PLATFORM_WA_CATEGORIES,
  PLATFORM_WA_EVENT_KEYS,
  PLATFORM_WA_LANGUAGES,
  syncPlatformWhatsAppTemplates,
} from '@/lib/platform-whatsapp-templates';
import { MetaWhatsAppError } from '@/lib/meta-whatsapp';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'super_admin');
  if (!auth.ok) return auth.response;

  const setup = metaWaSetupChecklist();
  try {
    const templates = await listPlatformWhatsAppTemplates();
    return NextResponse.json({
      templates,
      setup,
      eventKeys: PLATFORM_WA_EVENT_KEYS,
      languages: PLATFORM_WA_LANGUAGES,
      categories: PLATFORM_WA_CATEGORIES,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message, setup }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'super_admin');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const template = await createPlatformWhatsAppDraft({
      name: body.name,
      language: body.language,
      category: body.category,
      body_text: body.body_text,
      header_text: body.header_text,
      footer_text: body.footer_text,
      example_vars: Array.isArray(body.example_vars) ? body.example_vars.map(String) : [],
      event_key: body.event_key || null,
      created_by: auth.admin.id,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'super_admin');
  if (!auth.ok) return auth.response;
  try {
    const templates = await syncPlatformWhatsAppTemplates();
    return NextResponse.json({ templates });
  } catch (error: unknown) {
    if (error instanceof MetaWhatsAppError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
