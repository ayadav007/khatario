import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { logAdminAction } from '@/lib/platform-auth';
import { publishDuePosts } from '@/lib/marketing/posts';
import { queryRows } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') || 'https://khatario.com';
  try {
    const result = await publishDuePosts(origin);
    if (result.publishedIds.length > 0) {
      const posted = await queryRows<{ id: string; approved_by: string | null }>(
        `SELECT id, approved_by FROM marketing_posts WHERE id = ANY($1::uuid[])`,
        [result.publishedIds],
      );
      for (const post of posted) {
        if (post.approved_by) {
          await logAdminAction(post.approved_by, 'marketing_post_published', 'marketing_post', post.id);
        }
      }
    }
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Publish cron failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
