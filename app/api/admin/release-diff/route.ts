import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { getStagingProductionDiff } from '@/lib/staging-production-diff';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'viewer');
  if (!auth.ok) return auth.response;

  try {
    const diff = await getStagingProductionDiff();
    return NextResponse.json(diff);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
