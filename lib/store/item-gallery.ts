import { clipStoreMediaUrl } from '@/lib/store/store-theme';

const MAX_GALLERY = 8;

export function sanitizeGalleryUrls(raw: unknown, cover?: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    const url = clipStoreMediaUrl(value);
    if (!url || seen.has(url) || out.length >= MAX_GALLERY) return;
    seen.add(url);
    out.push(url);
  };
  push(cover);
  if (Array.isArray(raw)) {
    for (const item of raw) push(item);
  }
  return out;
}

export function extraGalleryUrls(all: string[], cover: string): string[] {
  const c = cover.trim();
  return all.filter((u) => u !== c);
}
