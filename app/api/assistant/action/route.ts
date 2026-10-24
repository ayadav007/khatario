import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { rateLimited } from '@/lib/rag/http';
import { handleAction } from '@/lib/rag/route-handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  const limited = rateLimited([[`assistant:action:user:${auth.userId}`, 10, 60_000]]);
  if (limited) return limited;
  return handleAction(request, {
    channel: 'trial_app',
    audience: 'tenant_user',
    userId: auth.userId,
    businessId: auth.businessId,
  });
}
