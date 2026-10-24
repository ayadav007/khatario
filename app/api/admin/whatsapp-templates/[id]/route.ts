import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import {
  deletePlatformWhatsAppTemplate,
  getPlatformWhatsAppTemplate,
  updatePlatformWhatsAppDraft,
} from '@/lib/platform-whatsapp-templates';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'super_admin');
  if (!auth.ok) return auth.response;
  const template = await getPlatformWhatsAppTemplate(params.id);
  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ template });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'super_admin');
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const template = await updatePlatformWhatsAppDraft(params.id, {
      name: body.name,
      language: body.language,
      category: body.category,
      body_text: body.body_text,
      header_text: body.header_text,
      footer_text: body.footer_text,
      example_vars: body.example_vars,
      event_key: body.event_key,
    });
    return NextResponse.json({ template });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'super_admin');
  if (!auth.ok) return auth.response;
  try {
    await deletePlatformWhatsAppTemplate(params.id);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
