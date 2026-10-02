import { NextRequest, NextResponse } from 'next/server';
import { logAdminAction } from '@/lib/platform-auth';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { updateMarketingPost } from '@/lib/marketing/posts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: { id: string } };

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const action = body.action === 'approve' || body.action === 'revert' ? body.action : undefined;
    const post = await updateMarketingPost({
      id: params.id,
      adminId: auth.admin.id,
      caption: typeof body.caption === 'string' ? body.caption : undefined,
      action,
    });
    if (action) {
      await logAdminAction(auth.admin.id, action === 'approve' ? 'marketing_post_approve' : 'marketing_post_revert', 'marketing_post', post.id);
    }
    return NextResponse.json({ post });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not update the post';
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
