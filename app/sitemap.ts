import type { MetadataRoute } from 'next';
import { listSitemapPosts } from '@/lib/blog/repo';
import { publicSiteUrl } from '@/lib/blog/site';
import { getPublishedMarketingDocument } from '@/lib/marketing-builder/pages-repo';
import { marketingRobots } from '@/lib/marketing-builder/seo';
import { MARKETING_STATIC_PATHS } from '@/lib/marketing/static-paths';
import { THEME_CATALOG } from '@/lib/store/engine/theme-catalog';

export const dynamic = 'force-dynamic';


export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = publicSiteUrl();
  let hideHome = false;
  try {
    const home = await getPublishedMarketingDocument('home');
    hideHome = marketingRobots(home?.root?.props?.robots) === 'noindex';
  } catch (error) {
    console.error('[sitemap] home page index flag skipped', error);
  }
  const paths = hideHome ? MARKETING_STATIC_PATHS.filter((path) => path !== '/') : MARKETING_STATIC_PATHS;
  const pages: MetadataRoute.Sitemap = paths.map((path) => ({
    url: `${base}${path === '/' ? '' : path}`,
    changeFrequency: path === '/blog' ? 'daily' : 'weekly',
    priority: path === '/' ? 1 : 0.6,
  }));
  // One page per theme with a demo store (app/themes/[slug]).
  for (const theme of THEME_CATALOG) {
    if (theme.demo) pages.push({ url: `${base}/themes/${theme.slug}`, changeFrequency: 'weekly', priority: 0.6 });
  }
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
