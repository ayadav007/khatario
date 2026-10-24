import { NextRequest, NextResponse } from 'next/server';
import { blogError, requireBlogAdmin } from '@/lib/blog/api';
import { storeBlogImage } from '@/lib/blog/media';
import { listBlogMedia, updateMediaAlt } from '@/lib/blog/repo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireBlogAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ items: await listBlogMedia() });
  } catch (error) {
    return blogError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireBlogAdmin(request);
  if (!auth.ok) return auth.response;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart upload' }, { status: 400 });
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }
  const alt = typeof form.get('alt') === 'string' ? String(form.get('alt')) : '';
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const media = await storeBlogImage(buffer, alt, auth.admin.id);
    return NextResponse.json({ media }, { status: 201 });
  } catch (error) {
    return blogError(error);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireBlogAdmin(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { id?: string; alt?: string } | null;
  if (!body?.id || typeof body.alt !== 'string') {
    return NextResponse.json({ error: 'Image id and alt text are required' }, { status: 400 });
  }
  const alt = body.alt.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!alt) return NextResponse.json({ error: 'Alt text is required' }, { status: 400 });
  try {
    const media = await updateMediaAlt(body.id, alt);
    if (!media) return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    return NextResponse.json({ media });
  } catch (error) {
    return blogError(error);
  }
}
