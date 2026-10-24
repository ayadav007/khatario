import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { removeVideo, streamVideo } from '../../route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: { stamp: string } }) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  const download = request.nextUrl.searchParams.get('download') === '1';
  const response = await streamVideo(context.params.stamp, download);
  return response ?? NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function DELETE(request: NextRequest, context: { params: { stamp: string } }) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  const removed = await removeVideo(context.params.stamp);
  if (!removed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
