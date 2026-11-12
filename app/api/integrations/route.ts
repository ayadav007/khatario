import { NextRequest, NextResponse } from 'next/server';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { listConnections } from '@/lib/integrations/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenant = await requireTenantPermission(request, searchParams.get('business_id'), 'settings', ['read', 'update']);
  if (!tenant.ok) return tenant.response;
  try {
    return NextResponse.json({ connections: await listConnections(tenant.businessId) });
  } catch (err) {
    console.error('integrations GET failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Could not load integrations' }, { status: 500 });
  }
}
