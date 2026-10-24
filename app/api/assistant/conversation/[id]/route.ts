import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { handleHistory } from '@/lib/rag/route-handlers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  return handleHistory(params.id, {
    channel: 'trial_app',
    audience: 'tenant_user',
    userId: auth.userId,
    businessId: auth.businessId,
  });
}
