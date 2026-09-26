import { clipStoreMediaUrl } from '@/lib/store/store-theme';

export const SEO_TITLE_MAX = 70;
export const SEO_DESC_MAX = 160;

export function clipSeoTitle(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, SEO_TITLE_MAX);
}

export function clipSeoDescription(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, SEO_DESC_MAX);
}

export function clipItemSeo(input: {
  seo_title?: unknown;
  seo_description?: unknown;
  seo_image_url?: unknown;
}): { seo_title: string | null; seo_description: string | null; seo_image_url: string | null } {
  const seo_title = clipSeoTitle(input.seo_title) || null;
  const seo_description = clipSeoDescription(input.seo_description) || null;
  const seo_image_url = clipStoreMediaUrl(input.seo_image_url) || null;
  return { seo_title, seo_description, seo_image_url };
}

export function resolveItemSeo(input: {
  name: string;
  description?: string | null;
  image_url?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_image_url?: string | null;
}): { title: string; description: string; image: string } {
  const title = clipSeoTitle(input.seo_title) || clipSeoTitle(input.name) || 'Product';
  const description =
    clipSeoDescription(input.seo_description) ||
    clipSeoDescription(input.description) ||
    title;
  const image = clipStoreMediaUrl(input.seo_image_url) || clipStoreMediaUrl(input.image_url);
  return { title, description, image };
}

export function seoTitleQuality(title: string): 'empty' | 'short' | 'ok' | 'long' {
  const n = title.trim().length;
  if (n === 0) return 'empty';
  if (n < 20) return 'short';
  if (n > 60) return 'long';
  return 'ok';
}

export function seoDescriptionQuality(description: string): 'empty' | 'short' | 'ok' | 'long' {
  const n = description.trim().length;
  if (n === 0) return 'empty';
  if (n < 50) return 'short';
  if (n > 160) return 'long';
  return 'ok';
}

export interface SeoDraftInput {
  name: string;
  description?: string | null;
  brand?: string | null;
  category?: string | null;
}

function firstSentence(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const cut = clean.split(/(?<=[.!?])\s+/)[0] || clean;
  return cut.slice(0, max).trim();
}

export function generateSeoTitleDraft(input: SeoDraftInput): string {
  const name = clipSeoTitle(input.name) || 'Product';
  const brand = clipSeoTitle(input.brand);
  const category = clipSeoTitle(input.category);
  const extras = [brand, category].filter((s) => s && s.toLowerCase() !== name.toLowerCase());
  const withPipe = extras.length > 0 ? `${name} | ${extras[0]}` : `${name} | Shop Online`;
  const titled = clipSeoTitle(withPipe);
  if (titled.length >= 20) return titled;
  return clipSeoTitle(`Buy ${name} Online`) || name;
}

export function generateSeoDescriptionDraft(input: SeoDraftInput): string {
  const name = clipSeoTitle(input.name) || 'this product';
  const fromDesc = firstSentence(String(input.description ?? ''), SEO_DESC_MAX);
  if (fromDesc.length >= 50) return clipSeoDescription(fromDesc);
  const brand = clipSeoTitle(input.brand);
  const category = clipSeoTitle(input.category);
  const bits = [`Shop ${name}`, category ? `in ${category}` : '', brand ? `from ${brand}` : '']
    .filter(Boolean)
    .join(' ');
  return clipSeoDescription(
    `${bits}. Quality you can trust — order online for a simple, fast checkout.`,
  );
}
