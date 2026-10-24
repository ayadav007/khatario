import { NextRequest, NextResponse } from 'next/server';
import { blogError, invalidateSaved, readBody, requireBlogAdmin } from '@/lib/blog/api';
import { deleteBlogPost, getAdminPost, saveBlogPost } from '@/lib/blog/repo';
import { parseBlogWrite, parseIntent } from '@/lib/blog/validate';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Ctx = { params: { id: string } };

export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = await requireBlogAdmin(request);
  if (!auth.ok) return auth.response;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  try {
    const post = await getAdminPost(params.id);
    if (!post) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    return NextResponse.json({ post });
  } catch (error) {
    return blogError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await requireBlogAdmin(request);
  if (!auth.ok) return auth.response;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  const intent = parseIntent(body.intent);
  try {
    const existing = await getAdminPost(params.id);
    if (!existing) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    const input = parseBlogWrite(body, intent === 'unpublish' ? 'save' : intent);
    const post = await saveBlogPost({ id: params.id, adminId: auth.admin.id, input, intent });
    invalidateSaved([existing.slug, post.slug]);
    return NextResponse.json({ post });
  } catch (error) {
    return blogError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const auth = await requireBlogAdmin(request);
  if (!auth.ok) return auth.response;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  try {
    const existing = await getAdminPost(params.id);
    if (!existing) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    await deleteBlogPost(params.id);
    invalidateSaved([existing.slug, existing.category_slug]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return blogError(error);
  }
}
