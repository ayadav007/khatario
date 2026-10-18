import { NextRequest, NextResponse } from 'next/server';
import { blogError, requireBlogAdmin } from '@/lib/blog/api';
import { slugAvailability } from '@/lib/blog/repo';
import { suggestSlug } from '@/lib/blog/slug';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const auth = await requireBlogAdmin(request);
  if (!auth.ok) return auth.response;
  const slug = suggestSlug(request.nextUrl.searchParams.get('slug') || '');
  const exclude = request.nextUrl.searchParams.get('exclude') || '';
  if (exclude && !UUID.test(exclude)) {
    return NextResponse.json({ error: 'Article id is not valid' }, { status: 400 });
  }
  try {
    const result = await slugAvailability(slug, exclude || null);
    return NextResponse.json({ slug, ...result });
  } catch (error) {
    return blogError(error);
  }
}
