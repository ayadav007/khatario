import type { Metadata } from 'next';
import { BlogListing } from '@/components/blog/BlogListing';
import { BlogShell } from '@/components/blog/BlogShell';
import { listPublicCategories, listPublishedCards } from '@/lib/blog/repo';
import { parsePage, publicSiteUrl } from '@/lib/blog/site';

export const dynamic = 'force-dynamic';

const TITLE = 'Blog';
const DESCRIPTION = 'Guides and notes from Khatario on GST billing, stock, and running a shop.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${publicSiteUrl()}/blog` },
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', url: `${publicSiteUrl()}/blog` },
};

export default async function BlogIndexPage({ searchParams }: { searchParams: { page?: string; q?: string; tag?: string } }) {
  const page = parsePage(searchParams.page);
  const q = searchParams.q?.trim() || '';
  const tag = searchParams.tag?.trim() || '';
  const [list, categories] = await Promise.all([
    listPublishedCards({ page, pageSize: 12, q, tagSlug: tag || null }),
    listPublicCategories(),
  ]);
  const pageCount = Math.max(1, Math.ceil(list.total / list.pageSize));
  return (
    <BlogShell>
      <BlogListing
        title={TITLE}
        description={DESCRIPTION}
        items={list.items}
        categories={categories}
        page={page}
        pageCount={pageCount}
        q={q}
        tag={tag}
      />
    </BlogShell>
  );
}
