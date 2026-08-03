/** First URL segment values that must not be used as business portal_slug. */
export const RESERVED_BUSINESS_SLUGS = new Set([
  'login',
  'signup',
  'dashboard',
  'admin',
  'api',
  'portal',
  'employees',
  'settings',
  'invoices',
  'items',
  'customers',
  'more',
  'offline',
  'guides',
  'book-demo',
  'attendance',
  'pay',
  'auth',
  'search',
  'tools',
  'reports',
  'purchases',
  'suppliers',
  'connect',
  'whatsapp',
  'hr',
  'crm',
  'i',
]);

/** URL-safe slug from business name (portal path segment). */
export function slugifyPortalSegment(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'business';
}

export function isValidPortalSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug);
}

export function isReservedBusinessSlug(segment: string): boolean {
  return RESERVED_BUSINESS_SLUGS.has(segment.trim().toLowerCase());
}

export function normalizePortalSlugInput(raw: string): string {
  return slugifyPortalSegment(raw);
}

export function validatePortalSlugFormat(
  slug: string
): { ok: true; slug: string } | { ok: false; error: string } {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) {
    return { ok: false, error: 'Portal address is required' };
  }
  if (normalized.length < 3) {
    return { ok: false, error: 'Portal address must be at least 3 characters' };
  }
  if (!isValidPortalSlug(normalized)) {
    return {
      ok: false,
      error: 'Use lowercase letters, numbers, and hyphens only (no spaces)',
    };
  }
  if (isReservedBusinessSlug(normalized)) {
    return {
      ok: false,
      error: `"${normalized}" is reserved. Choose a different portal address.`,
    };
  }
  return { ok: true, slug: normalized };
}
