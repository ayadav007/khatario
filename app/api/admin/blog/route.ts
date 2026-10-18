import { NextRequest, NextResponse } from 'next/server';
import { blogError, invalidateSaved, readBody, requireBlogAdmin } from '@/lib/blog/api';
import { listAdminPosts, saveBlogPost } from '@/lib/blog/repo';
import { parsePage } from '@/lib/blog/site';
import { parseBlogWrite, parseIntent } from '@/lib/blog/validate';
import type { BlogStatus } from '@/lib/blog/workflow';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireBlogAdmin(request);
  if (!auth.ok) return auth.response;
  const status = request.nextUrl.searchParams.get('status');
  const filter: BlogStatus | null = status === 'draft' || status === 'published' ? status : null;
  const q = request.nextUrl.searchParams.get('q')?.trim() || '';
  const page = parsePage(request.nextUrl.searchParams.get('page') || undefined);
  try {
    const result = await listAdminPosts({ status: filter, q, page, pageSize: 20 });
    return NextResponse.json(result);
  } catch (error) {
    return blogError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireBlogAdmin(request);
  if (!auth.ok) return auth.response;
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  const intent = parseIntent(body.intent);
  try {
    const input = parseBlogWrite(body, intent === 'unpublish' ? 'save' : intent);
    const post = await saveBlogPost({ adminId: auth.admin.id, input, intent: intent === 'unpublish' ? 'save' : intent });
    invalidateSaved([post.slug]);
    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    return blogError(error);
  }
}
