import { NextRequest, NextResponse } from 'next/server';
import { withTenantTemplates } from '@/lib/whatsapp/tenant-template-route';
import { deleteBusinessTemplate, updateBusinessTemplateDraft } from '@/lib/whatsapp/tenant-templates';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return withTenantTemplates(request, 'update', async ({ businessId }) => {
    if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const template = await updateBusinessTemplateDraft(businessId, params.id, body);
    return NextResponse.json({ template });
  });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  return withTenantTemplates(request, 'update', async ({ businessId }) => {
    if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    await deleteBusinessTemplate(businessId, params.id);
    return NextResponse.json({ ok: true });
  });
}
