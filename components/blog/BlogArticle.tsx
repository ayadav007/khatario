import Link from 'next/link';
import { sanitizeBlogHtml } from '@/lib/blog/html';
import { formatBlogDate } from '@/lib/blog/site';
import type { BlogTag } from '@/lib/blog/repo';
import './blog-content.css';

export function BlogArticle({
  title,
  excerpt,
  author,
  publishedAt,
  categoryName,
  categorySlug,
  tags,
  featuredUrl,
  featuredAlt,
  html,
}: {
  title: string;
  excerpt?: string;
  author: string;
  publishedAt: string | null;
  categoryName?: string | null;
  categorySlug?: string | null;
  tags: BlogTag[];
  featuredUrl?: string | null;
  featuredAlt?: string | null;
  html: string;
}) {
  const safeHtml = sanitizeBlogHtml(html);
  const date = formatBlogDate(publishedAt);
  return (
    <article>
      {categoryName && categorySlug ? (
        <Link href={`/blog/category/${categorySlug}`} className="text-sm font-semibold text-teal-700 hover:text-teal-800">
          {categoryName}
        </Link>
      ) : null}
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
      <p className="mt-3 text-sm text-slate-500">
        {author ? <span>{author}</span> : null}
        {author && date ? <span aria-hidden> · </span> : null}
        {date ? <time dateTime={publishedAt || undefined}>{date}</time> : null}
      </p>
      {excerpt ? <p className="mt-4 text-lg text-slate-600">{excerpt}</p> : null}
      {featuredUrl ? (
        <img
          src={featuredUrl}
          alt={featuredAlt || ''}
          className="mt-8 aspect-video w-full rounded-2xl object-cover"
        />
      ) : null}
      <div className="blog-content mt-8" dangerouslySetInnerHTML={{ __html: safeHtml }} />
      {tags.length ? (
        <ul className="mt-10 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag.id}>
              <Link href={`/blog?tag=${encodeURIComponent(tag.slug)}`} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700 hover:bg-slate-200">
                {tag.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
