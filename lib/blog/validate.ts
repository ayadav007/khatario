import { articleHasBody, sanitizeBlogHtml } from '@/lib/blog/html';
import { isValidSlug, suggestSlug } from '@/lib/blog/slug';
import type { BlogIntent } from '@/lib/blog/workflow';

export class BlogInputError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'BlogInputError';
    this.status = status;
  }
}

export type BlogWriteInput = {
  title: string;
  slug: string;
  excerpt: string;
  contentHtml: string;
  authorName: string;
  categoryId: string | null;
  categoryName: string | null;
  tags: string[];
  featuredMediaId: string | null;
  ogMediaId: string | null;
  seoTitle: string;
  metaDescription: string;
  focusKeyword: string;
  canonicalUrl: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function raw(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, max);
}

function uuidOrNull(value: unknown, label: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new BlogInputError(`${label} is not valid`);
  }
  return value;
}

export function parseBlogWrite(body: Record<string, unknown>, intent: BlogIntent): BlogWriteInput {
  const title = text(body.title, 180);
  if (!title) throw new BlogInputError('Title is required');

  const slugSource = text(body.slug, 80) || suggestSlug(title);
  const slug = suggestSlug(slugSource);
  if (!isValidSlug(slug)) throw new BlogInputError('Use a slug with lowercase letters, numbers, and hyphens');

  const excerpt = text(body.excerpt, 500);
  const contentHtml = sanitizeBlogHtml(raw(body.content_html ?? body.contentHtml, 200_000));
  const authorName = text(body.author_name ?? body.authorName, 120);
  const categoryId = uuidOrNull(body.category_id ?? body.categoryId, 'Category');
  const categoryName = text(body.category_name ?? body.categoryName, 80) || null;
  const featuredMediaId = uuidOrNull(body.featured_media_id ?? body.featuredMediaId, 'Featured image');
  const ogMediaId = uuidOrNull(body.og_media_id ?? body.ogMediaId, 'Open Graph image');
  const seoTitle = text(body.seo_title ?? body.seoTitle, 70);
  const metaDescription = text(body.meta_description ?? body.metaDescription, 200);
  const focusKeyword = text(body.focus_keyword ?? body.focusKeyword, 80);
  const canonicalRaw = text(body.canonical_url ?? body.canonicalUrl, 500);
  let canonicalUrl = '';
  if (canonicalRaw) {
    let url: URL;
    try {
      url = new URL(canonicalRaw);
    } catch {
      throw new BlogInputError('Canonical URL must be a valid https URL');
    }
    if (url.protocol !== 'https:') throw new BlogInputError('Canonical URL must start with https://');
    canonicalUrl = url.toString();
  }

  const tagSource = Array.isArray(body.tags) ? body.tags : [];
  const tags: string[] = [];
  for (const tag of tagSource) {
    const name = text(tag, 40);
    if (!name || tags.some((item) => item.toLowerCase() === name.toLowerCase())) continue;
    tags.push(name);
    if (tags.length >= 12) break;
  }

  if (intent === 'publish') {
    if (!authorName) throw new BlogInputError('Author is required before publishing');
    if (!articleHasBody(contentHtml)) throw new BlogInputError('Add some article content before publishing');
  }

  return {
    title,
    slug,
    excerpt,
    contentHtml,
    authorName,
    categoryId,
    categoryName,
    tags,
    featuredMediaId,
    ogMediaId,
    seoTitle,
    metaDescription,
    focusKeyword,
    canonicalUrl,
  };
}

export function parseIntent(value: unknown): BlogIntent {
  if (value === 'publish' || value === 'unpublish' || value === 'save') return value;
  return 'save';
}
