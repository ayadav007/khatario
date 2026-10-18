const RESERVED = new Set([
  'category',
  'tag',
  'new',
  'page',
  'admin',
  'preview',
  'feed',
  'rss',
  'sitemap',
]);

export function suggestSlug(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'post';
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug);
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 80 && !isReservedSlug(slug);
}
