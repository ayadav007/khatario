import type { Metadata } from 'next';
import { BlogListing } from '@/components/blog/BlogListing';
import { BlogShell } from '@/components/blog/BlogShell';
import { listPublicCategories, listPublishedCards } from '@/lib/blog/repo';
import { parsePage, publicSiteUrl } from '@/lib/blog/site';

export const dynamic = 'force-dynamic';

const TITLE = 'Khatario Blog: GST, Billing & Shop Business Tips';
const DESCRIPTION = 'Practical articles for Indian shop owners on GST billing, returns, stock, udhaar, WhatsApp invoices and growing a small business.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `${publicSiteUrl()}/blog` },
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', url: `${publicSiteUrl()}/blog`, images: ['/opengraph-image'] },
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
