'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { BlogArticle } from '@/components/blog/BlogArticle';
import type { AdminBlogPost } from '@/lib/blog/repo';

export function BlogPreview({ id }: { id: string }) {
  const [post, setPost] = useState<AdminBlogPost | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetch(`/api/admin/blog/${id}`, platformAdminFetchInit)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Preview is not available');
        return data.post as AdminBlogPost;
      })
      .then(setPost)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  if (error) return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!post) return <p className="text-sm text-gray-500">Loading preview…</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {post.status === 'published' ? 'This article is public.' : 'Draft preview. This URL is only available to signed-in administrators.'}
        {' '}
        <Link href={`/admin/blog/${post.id}`} className="font-semibold underline">Back to editor</Link>
      </div>
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
  );
}
