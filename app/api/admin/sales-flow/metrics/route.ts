import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { funnelMetrics } from '@/lib/sales-funnel/admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'support');
  if (!auth.ok) return auth.response;
  const days = Number(request.nextUrl.searchParams.get('days')) || 30;
  try {
    return NextResponse.json(await funnelMetrics(days));
  } catch (err) {
    console.error('[admin/sales-flow/metrics] failed:', err);
    return NextResponse.json({ error: 'Could not load metrics' }, { status: 500 });
  }
}
