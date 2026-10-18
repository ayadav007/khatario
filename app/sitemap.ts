import type { MetadataRoute } from 'next';
import { listSitemapPosts } from '@/lib/blog/repo';
import { publicSiteUrl } from '@/lib/blog/site';

export const dynamic = 'force-dynamic';

const STATIC_PATHS = ['/', '/blog', '/guides', '/privacy', '/terms', '/book-demo', '/solution/accounting', '/solution/inventory'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = publicSiteUrl();
  const pages: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${base}${path === '/' ? '' : path}`,
    changeFrequency: path === '/blog' ? 'daily' : 'weekly',
    priority: path === '/' ? 1 : 0.6,
  }));
  try {
    const posts = await listSitemapPosts();
    for (const post of posts) {
      pages.push({
        url: `${base}/blog/${post.slug}`,
        lastModified: post.updated_at,
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }
  } catch (error) {
    console.error('[sitemap] blog posts skipped', error);
  }
  return pages;
}
