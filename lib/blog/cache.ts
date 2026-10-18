import { revalidatePath } from 'next/cache';

export function invalidateBlog(slugs: string[]) {
  revalidatePath('/blog');
  revalidatePath('/sitemap.xml');
  const unique = new Set(slugs.filter(Boolean));
  for (const slug of unique) {
    revalidatePath(`/blog/${slug}`);
    revalidatePath(`/blog/category/${slug}`);
  }
}
