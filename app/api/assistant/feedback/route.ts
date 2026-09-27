import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { handleFeedback } from '@/lib/rag/route-handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  return handleFeedback(request, {
    channel: 'trial_app',
    audience: 'tenant_user',
    userId: auth.userId,
    businessId: auth.businessId,
  });
}
