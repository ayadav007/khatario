import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { streamVideo } from '../../route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: { stamp: string } }) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  const response = await streamVideo(context.params.stamp);
  return response ?? NextResponse.json({ error: 'Not found' }, { status: 404 });
}
