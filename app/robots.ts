import type { MetadataRoute } from 'next';
import { publicSiteUrl } from '@/lib/blog/site';

const PRODUCTION_HOSTS = new Set(['khatario.com', 'www.khatario.com']);

/** Only production is indexable; staging and local builds tell crawlers to stay out. */
export default function robots(): MetadataRoute.Robots {
  const base = publicSiteUrl();
  if (!PRODUCTION_HOSTS.has(new URL(base).hostname.toLowerCase())) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin/', '/i/', '/r/', '/track/', '/pay/', '/print/', '/offline'],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
