import { NextRequest, NextResponse } from 'next/server';
import { isTenantWaEventKey } from '@/lib/whatsapp/tenant-events';
import { withTenantTemplates } from '@/lib/whatsapp/tenant-template-route';
import { listEventMappings, useSuggestedTemplate } from '@/lib/whatsapp/tenant-templates';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { key: string } }) {
  return withTenantTemplates(request, 'update', async ({ businessId, userId }) => {
    if (!isTenantWaEventKey(params.key)) {
      return NextResponse.json({ error: 'Unknown message type' }, { status: 400 });
    }
    const template = await useSuggestedTemplate(businessId, userId, params.key);
    return NextResponse.json({ template, mappings: await listEventMappings(businessId) });
  });
}
