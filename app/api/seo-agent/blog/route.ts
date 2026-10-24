import { NextRequest, NextResponse } from 'next/server';
import { blogError, invalidateSaved, readBody } from '@/lib/blog/api';
import { getAdminPost, listAdminPosts, listCategories, saveBlogPost } from '@/lib/blog/repo';
import { requireSeoAgent } from '@/lib/blog/seo-agent-auth';
import { parseBlogWrite } from '@/lib/blog/validate';

export const dynamic = 'force-dynamic';

/**
 * GET /api/seo-agent/blog — every article (draft and published) so the agent avoids duplicate topics.
 * POST /api/seo-agent/blog — create a draft, or update one by `id`. Never publishes, and refuses
 * published articles: a person publishes from /admin/blog.
 */
export async function GET(request: NextRequest) {
  const auth = requireSeoAgent(request);
  if (!auth.ok) return auth.response;
  try {
    const posts = [];
    for (let page = 1; page <= 50; page++) {
      const result = await listAdminPosts({ status: null, q: '', page, pageSize: 50 });
      posts.push(...result.items.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        status: p.status,
        focus_keyword: p.focus_keyword,
        published_at: p.published_at,
        updated_at: p.updated_at,
      })));
      if (page * 50 >= result.total) break;
    }
    const categories = (await listCategories()).map((c) => ({ id: c.id, name: c.name, slug: c.slug }));
    return NextResponse.json({ posts, categories });
  } catch (error) {
    return blogError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = requireSeoAgent(request);
  if (!auth.ok) return auth.response;
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;
  try {
    if (id) {
      const existing = await getAdminPost(id);
      if (!existing) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
      if (existing.status !== 'draft' || existing.published_at) {
        return NextResponse.json({ error: 'Only unpublished drafts can be changed by the SEO agent' }, { status: 409 });
      }
    }
    const input = parseBlogWrite(body, 'save');
    const post = await saveBlogPost({ id, adminId: auth.adminId, input, intent: 'save' });
    invalidateSaved([post.slug]);
    return NextResponse.json(
      { post: { id: post.id, slug: post.slug, title: post.title, status: post.status } },
      { status: id ? 200 : 201 },
    );
  } catch (error) {
    return blogError(error);
  }
}
