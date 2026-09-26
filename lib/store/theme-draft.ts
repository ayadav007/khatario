import { createHmac, randomBytes } from 'crypto';
import { sanitizeStoreTheme, type StoreTheme } from '@/lib/store/store-theme';

type DraftRow = { businessId: string; theme: StoreTheme; exp: number };

const g = globalThis as typeof globalThis & { __khatarioThemeDrafts?: Map<string, DraftRow> };
const drafts = (g.__khatarioThemeDrafts ??= new Map<string, DraftRow>());

function secret(): string {
  return process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'khatario-dev-theme-draft';
}

function prune() {
  const now = Date.now();
  for (const [id, row] of drafts) {
    if (row.exp < now) drafts.delete(id);
  }
}

function slimTheme(theme: StoreTheme): StoreTheme {
  return {
    ...theme,
    logo_url: theme.logo_url.startsWith('data:') ? '' : theme.logo_url,
    favicon_url: theme.favicon_url.startsWith('data:') ? '' : theme.favicon_url,
    hero_slides: theme.hero_slides.map((s) => ({
      ...s,
      image_url: s.image_url.startsWith('data:') ? '' : s.image_url,
    })),
    category_images: Object.fromEntries(
      Object.entries(theme.category_images).filter(([, u]) => !u.startsWith('data:')),
    ),
    overlay_bands: theme.overlay_bands.map((b) => ({
      ...b,
      image_url: b.image_url.startsWith('data:') ? '' : b.image_url,
    })),
    testimonials: theme.testimonials.map((t) => ({
      ...t,
      photo_url: t.photo_url.startsWith('data:') ? '' : t.photo_url,
    })),
    custom_css: theme.custom_css.slice(0, 2000),
  };
}

/** Short id stored in memory (URL-safe). HMAC string kept as fallback for old links. */
export function signThemeDraft(businessId: string, theme: StoreTheme): string {
  prune();
  const id = randomBytes(8).toString('hex');
  drafts.set(id, {
    businessId,
    theme: slimTheme(theme),
    exp: Date.now() + 30 * 60 * 1000,
  });
  return id;
}

export function readThemeDraft(
  token: string | null | undefined,
  businessId: string,
): StoreTheme | null {
  if (!token) return null;
  prune();
  const mem = drafts.get(token);
  if (mem) {
    if (mem.businessId !== businessId || mem.exp < Date.now()) return null;
    return sanitizeStoreTheme(mem.theme);
  }
  if (!token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
  if (expected.length !== sig.length) return null;
  let ok = 0;
  for (let i = 0; i < expected.length; i += 1) ok |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (ok !== 0) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      businessId?: string;
      theme?: unknown;
      exp?: number;
    };
    if (parsed.businessId !== businessId) return null;
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    return sanitizeStoreTheme(parsed.theme);
  } catch {
    return null;
  }
}
