import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { streamShot } from '../../route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: { name: string } }) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  const response = await streamShot(context.params.name);
  return response ?? NextResponse.json({ error: 'Not found' }, { status: 404 });
}
