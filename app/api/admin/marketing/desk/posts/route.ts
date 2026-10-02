import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { listMarketingPosts } from '@/lib/marketing/posts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  const status = request.nextUrl.searchParams.get('status') || 'all';
  try {
    const posts = await listMarketingPosts(status);
    return NextResponse.json({ posts });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not load posts';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
