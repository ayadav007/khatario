'use client';

import { BlogEditor } from '@/components/admin/blog/BlogEditor';

export default function EditBlogPage({ params }: { params: { id: string } }) {
  return <BlogEditor postId={params.id} />;
}
