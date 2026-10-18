import Link from 'next/link';
import { formatBlogDate } from '@/lib/blog/site';
import type { BlogCard, BlogCategory } from '@/lib/blog/repo';

export function BlogListing({
  title,
  description,
  items,
  categories,
  activeCategory,
  page,
  pageCount,
  q,
  tag,
}: {
  title: string;
  description: string;
  items: BlogCard[];
  categories: BlogCategory[];
  activeCategory?: string | null;
  page: number;
  pageCount: number;
  q?: string;
  tag?: string;
}) {
  const query = (nextPage: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tag) params.set('tag', tag);
    if (nextPage > 1) params.set('page', String(nextPage));
    const suffix = params.toString();
    const path = activeCategory ? `/blog/category/${activeCategory}` : '/blog';
    return suffix ? `${path}?${suffix}` : path;
  };

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
      <p className="mt-2 max-w-2xl text-slate-600">{description}</p>
      <form action={activeCategory ? `/blog/category/${activeCategory}` : '/blog'} className="mt-6 flex gap-2">
        {tag ? <input type="hidden" name="tag" value={tag} /> : null}
        <input
          name="q"
          defaultValue={q || ''}
          placeholder="Search articles"
          className="h-11 w-full max-w-md rounded-lg border border-slate-300 px-3 text-base"
        />
        <button type="submit" className="h-11 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white">Search</button>
      </form>
      {categories.length ? (
        <nav className="mt-5 flex flex-wrap gap-2" aria-label="Categories">
          <Link href="/blog" className={`rounded-full px-3 py-1 text-sm ${!activeCategory ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>
            All
          </Link>
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/blog/category/${category.slug}`}
              className={`rounded-full px-3 py-1 text-sm ${activeCategory === category.slug ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}
            >
              {category.name}
            </Link>
          ))}
        </nav>
      ) : null}
      {items.length === 0 ? (
        <p className="mt-10 rounded-2xl bg-white p-8 text-slate-600 ring-1 ring-slate-200">No published articles yet.</p>
      ) : (
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.id} className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
              <Link href={`/blog/${item.slug}`} className="block h-full">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.image_alt || ''} className="aspect-video w-full object-cover" />
                ) : (
                  <div className="aspect-video w-full bg-slate-100" />
                )}
                <div className="p-4">
                  {item.category_name ? <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{item.category_name}</p> : null}
                  <h2 className="mt-1 text-lg font-semibold text-slate-900">{item.title}</h2>
                  {item.excerpt ? <p className="mt-2 line-clamp-3 text-sm text-slate-600">{item.excerpt}</p> : null}
                  {item.published_at ? <p className="mt-3 text-xs text-slate-500">{formatBlogDate(item.published_at)}</p> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {pageCount > 1 ? (
        <nav className="mt-8 flex items-center justify-between text-sm" aria-label="Pagination">
          {page > 1 ? <Link href={query(page - 1)} className="font-medium text-teal-700">Previous</Link> : <span />}
          <span className="text-slate-500">Page {page} of {pageCount}</span>
          {page < pageCount ? <Link href={query(page + 1)} className="font-medium text-teal-700">Next</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
