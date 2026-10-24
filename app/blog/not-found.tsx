import Link from 'next/link';
import { BlogShell } from '@/components/blog/BlogShell';

export default function BlogNotFound() {
  return (
    <BlogShell>
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Article not found</h1>
        <p className="mt-2 text-slate-600">This page is not published.</p>
        <Link href="/blog" className="mt-6 inline-flex h-11 items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white">
          Back to the blog
        </Link>
      </div>
    </BlogShell>
  );
}
