import { NextRequest, NextResponse } from 'next/server';
import { withTenantTemplates } from '@/lib/whatsapp/tenant-template-route';
import { submitBusinessTemplate } from '@/lib/whatsapp/tenant-templates';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return withTenantTemplates(request, 'update', async ({ businessId }) => {
    if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    const template = await submitBusinessTemplate(businessId, params.id);
    return NextResponse.json({ template });
  });
}
