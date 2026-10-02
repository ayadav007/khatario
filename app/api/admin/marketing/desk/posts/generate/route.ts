import { NextRequest, NextResponse } from 'next/server';
import { logAdminAction } from '@/lib/platform-auth';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { generateMarketingPost } from '@/lib/marketing/posts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const post = await generateMarketingPost({
      adminId: auth.admin.id,
      scheduledFor: String(body.scheduled_for || ''),
      angle: String(body.angle || ''),
    });
    await logAdminAction(auth.admin.id, 'marketing_post_draft', 'marketing_post', post.id);
    return NextResponse.json({ post });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not generate a draft';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
