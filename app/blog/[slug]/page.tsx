import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { BlogArticle } from '@/components/blog/BlogArticle';
import { BlogShell } from '@/components/blog/BlogShell';
import { resolvePublicSlug } from '@/lib/blog/repo';
import { absoluteUrl, articlePublicPath, publicSiteUrl } from '@/lib/blog/site';

export const dynamic = 'force-dynamic';

type Props = { params: { slug: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolved = await resolvePublicSlug(params.slug).catch(() => null);
  if (!resolved || resolved.type !== 'post') return { title: 'Article', robots: { index: false, follow: false } };
  const post = resolved.post;
  const title = post.seo_title || post.title;
  const description = post.meta_description || post.excerpt || undefined;
  const url = post.canonical_url || `${publicSiteUrl()}${articlePublicPath(post.slug)}`;
  const image = post.og_media?.url || post.featured_media?.url;
  const images = image ? [{ url: absoluteUrl(image), alt: post.og_media?.alt_text || post.featured_media?.alt_text || title }] : undefined;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'article',
      url,
      title,
      description,
      siteName: 'Khatario',
      publishedTime: post.published_at || undefined,
      modifiedTime: post.updated_at,
      images,
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title,
      description,
      images: images?.map((item) => item.url),
    },
    keywords: post.focus_keyword ? [post.focus_keyword] : undefined,
  };
}

export default async function BlogArticlePage({ params }: Props) {
  const resolved = await resolvePublicSlug(params.slug);
  if (!resolved) notFound();
  if (resolved.type === 'redirect') permanentRedirect(articlePublicPath(resolved.slug));
  const post = resolved.post;
  const url = post.canonical_url || `${publicSiteUrl()}${articlePublicPath(post.slug)}`;
  const image = post.og_media?.url || post.featured_media?.url;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.seo_title || post.title,
    description: post.meta_description || post.excerpt || undefined,
    datePublished: post.published_at || undefined,
    dateModified: post.updated_at,
    author: { '@type': 'Person', name: post.author_name || 'Khatario' },
    publisher: { '@type': 'Organization', name: 'Khatario', url: publicSiteUrl() },
    mainEntityOfPage: url,
    image: image ? [absoluteUrl(image)] : undefined,
    keywords: post.focus_keyword || undefined,
    articleSection: post.category_name || undefined,
  };
  return (
    <BlogShell>
      <div className="mx-auto max-w-3xl">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
        <BlogArticle
          title={post.title}
          excerpt={post.excerpt}
          author={post.author_name}
          publishedAt={post.published_at}
          categoryName={post.category_name}
          categorySlug={post.category_slug}
          tags={post.tags}
          featuredUrl={post.featured_media?.url}
          featuredAlt={post.featured_media?.alt_text}
          html={post.content_html}
        />
      </div>
    </BlogShell>
  );
}
