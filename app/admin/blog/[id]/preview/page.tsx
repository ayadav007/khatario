import type { Metadata } from 'next';
import { BlogPreview } from '@/components/admin/blog/BlogPreview';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: 'Article preview',
};

export default function AdminBlogPreviewPage({ params }: { params: { id: string } }) {
  return <BlogPreview id={params.id} />;
}
