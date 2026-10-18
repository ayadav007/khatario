export function publicSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://khatario.com';
  return raw.replace(/\/$/, '');
}

export function absoluteUrl(pathOrUrl: string, base = publicSiteUrl()): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${base}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

export function articlePublicPath(slug: string): string {
  return `/blog/${slug}`;
}

export function parsePage(value: string | undefined): number {
  const page = Number.parseInt(value || '1', 10);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(page, 500);
}

export function formatBlogDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}
