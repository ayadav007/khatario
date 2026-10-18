'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { formatBlogDate } from '@/lib/blog/site';
import type { AdminBlogPost } from '@/lib/blog/repo';

type Filter = '' | 'draft' | 'published';

export function BlogList() {
  const router = useRouter();
  const [items, setItems] = useState<AdminBlogPost[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Filter>('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set('q', query);
    if (status) params.set('status', status);
    void fetch(`/api/admin/blog?${params}`, platformAdminFetchInit)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load articles');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setItems(data.items || []);
        setTotal(data.total || 0);
        setError('');
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, query, status]);

  async function act(id: string, intent: 'publish' | 'unpublish' | 'delete', post: AdminBlogPost) {
    setError('');
    setMessage('');
    if (intent === 'delete') {
      const response = await fetch(`/api/admin/blog/${id}`, { ...platformAdminFetchInit, method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Delete failed');
        return;
      }
      setMessage('Article deleted.');
      setPendingDelete(null);
      setItems((current) => current.filter((item) => item.id !== id));
      setTotal((value) => Math.max(0, value - 1));
      return;
    }
    const response = await fetch(`/api/admin/blog/${id}`, {
      ...platformAdminFetchInit,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent,
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        content_html: post.content_html,
        author_name: post.author_name,
        category_id: post.category_id,
        tags: post.tags.map((tag) => tag.name),
        featured_media_id: post.featured_media?.id || null,
        og_media_id: post.og_media?.id || null,
        seo_title: post.seo_title,
        meta_description: post.meta_description,
        focus_keyword: post.focus_keyword,
        canonical_url: post.canonical_url,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || 'Update failed');
      return;
    }
    setMessage(intent === 'publish' ? 'Published.' : 'Unpublished.');
    setItems((current) => current.map((item) => (item.id === id ? data.post : item)));
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Blog</h1>
          <p className="text-sm text-gray-500">{total} article{total === 1 ? '' : 's'}</p>
        </div>
        <Link href="/admin/blog/new" className="inline-flex h-11 items-center rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white">New article</Link>
      </div>
      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setQuery(q.trim());
        }}
      >
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search title, excerpt, or slug" className="h-11 w-full rounded-lg border border-gray-300 px-3 text-base" />
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as Filter);
            setPage(1);
          }}
          className="h-11 rounded-lg border border-gray-300 px-3 text-base"
        >
          <option value="">All</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
        <button type="submit" className="h-11 rounded-lg border border-gray-300 px-4 text-sm font-semibold">Search</button>
      </form>
      {message ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p> : null}
      {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="mt-6 text-sm text-gray-500">Loading articles…</p> : null}
      {!loading && items.length === 0 ? <p className="mt-6 rounded-xl bg-white p-6 text-sm text-gray-600 ring-1 ring-gray-200">No articles match.</p> : null}
      <ul className="mt-4 space-y-3">
        {items.map((post) => (
          <li key={post.id} className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900">{post.title}</p>
                <p className="mt-1 text-sm text-gray-500">/{post.slug} · {post.status === 'published' ? `Published ${formatBlogDate(post.published_at)}` : 'Draft'}</p>
                {post.excerpt ? <p className="mt-1 line-clamp-2 text-sm text-gray-600">{post.excerpt}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/admin/blog/${post.id}`} className="inline-flex h-10 items-center rounded-lg border border-gray-300 px-3 text-sm font-semibold">Edit</Link>
                <Link href={`/admin/blog/${post.id}/preview`} className="inline-flex h-10 items-center rounded-lg border border-gray-300 px-3 text-sm font-semibold">Preview</Link>
                {post.status === 'published' ? (
                  <button type="button" onClick={() => void act(post.id, 'unpublish', post)} className="h-10 rounded-lg border border-amber-300 px-3 text-sm font-semibold text-amber-800">Unpublish</button>
                ) : (
                  <button type="button" onClick={() => void act(post.id, 'publish', post)} className="h-10 rounded-lg bg-primary-600 px-3 text-sm font-semibold text-white">Publish</button>
                )}
                {pendingDelete === post.id ? (
                  <>
                    <button type="button" onClick={() => void act(post.id, 'delete', post)} className="h-10 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white">Confirm delete</button>
                    <button type="button" onClick={() => setPendingDelete(null)} className="h-10 rounded-lg border border-gray-300 px-3 text-sm">Cancel</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setPendingDelete(post.id)} className="h-10 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700">Delete</button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {pageCount > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="h-10 rounded-lg border border-gray-300 px-3 disabled:opacity-40">Previous</button>
          <span className="text-gray-500">Page {page} of {pageCount}</span>
          <button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)} className="h-10 rounded-lg border border-gray-300 px-3 disabled:opacity-40">Next</button>
        </div>
      ) : null}
    </div>
  );
}
