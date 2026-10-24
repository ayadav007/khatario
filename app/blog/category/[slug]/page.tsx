import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlogListing } from '@/components/blog/BlogListing';
import { BlogShell } from '@/components/blog/BlogShell';
import { getCategoryBySlug, listPublicCategories, listPublishedCards } from '@/lib/blog/repo';
import { parsePage, publicSiteUrl } from '@/lib/blog/site';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const category = await getCategoryBySlug(params.slug).catch(() => null);
  if (!category) return { title: 'Blog', robots: { index: false, follow: false } };
  const title = `${category.name} — Blog`;
  const description = `Articles in ${category.name}.`;
  const url = `${publicSiteUrl()}/blog/category/${category.slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website' },
  };
}

export default async function BlogCategoryPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { page?: string; q?: string };
}) {
  const category = await getCategoryBySlug(params.slug);
  if (!category) notFound();
  const page = parsePage(searchParams.page);
  const q = searchParams.q?.trim() || '';
  const [list, categories] = await Promise.all([
    listPublishedCards({ page, pageSize: 12, categorySlug: category.slug, q }),
    listPublicCategories(),
  ]);
  const pageCount = Math.max(1, Math.ceil(list.total / list.pageSize));
  return (
    <BlogShell>
      <BlogListing
        title={category.name}
        description={`Articles in ${category.name}.`}
        items={list.items}
        categories={categories}
        activeCategory={category.slug}
        page={page}
        pageCount={pageCount}
        q={q}
      />
    </BlogShell>
  );
}
