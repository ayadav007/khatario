import { NextRequest, NextResponse } from 'next/server';
import { isMetaWaConfigured } from '@/lib/meta-whatsapp';
import { withTenantTemplates } from '@/lib/whatsapp/tenant-template-route';
import {
  createBusinessTemplateDraft,
  listBusinessTemplates,
  listEventMappings,
} from '@/lib/whatsapp/tenant-templates';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return withTenantTemplates(request, 'read', async ({ businessId }) => {
    const [templates, mappings, cloudReady] = await Promise.all([
      listBusinessTemplates(businessId),
      listEventMappings(businessId),
      isMetaWaConfigured(businessId).catch(() => false),
    ]);
    return NextResponse.json({ templates, mappings, cloud_ready: cloudReady });
  });
}

export async function POST(request: NextRequest) {
  return withTenantTemplates(request, 'update', async ({ businessId, userId }) => {
    const body = await request.json().catch(() => ({}));
    const template = await createBusinessTemplateDraft(businessId, userId, body);
    return NextResponse.json({ template }, { status: 201 });
  });
}
