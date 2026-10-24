import { NextRequest, NextResponse } from 'next/server';
import { withTenantTemplates } from '@/lib/whatsapp/tenant-template-route';
import { syncBusinessTemplates } from '@/lib/whatsapp/tenant-templates';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return withTenantTemplates(request, 'update', async ({ businessId }) => {
    const templates = await syncBusinessTemplates(businessId);
    return NextResponse.json({ templates });
  });
}
