import { ctaTarget } from './links';
import type { Block, Section } from './types';

// Client-safe and pure: the caller supplies each block's settings (the renderer passes `blockSettings`).

export type GalleryImage = { id: string; image: string; caption: string; subcaption: string; href: string | null };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * An Image gallery's pictures in block order. Skipped: disabled and unknown blocks and blocks with no image.
 * `href` follows the same rules as a button's link; anything that is not a page, an anchor or https is no link.
 */
export function galleryImages(section: Section, settingsOf: (block: Block) => Record<string, unknown> | null): GalleryImage[] {
  const images: GalleryImage[] = [];
  for (const id of section.block_order ?? []) {
    const block = section.blocks?.[id];
    if (!block || block.disabled || block.type !== 'image') continue;
    const s = settingsOf(block);
    if (!s) continue;
    const image = str(s.image).trim();
    if (!image) continue;
    const t = ctaTarget(s.link);
    const href = t.kind === 'internal' || t.kind === 'external' ? t.href : t.kind === 'anchor' ? `#${t.id}` : null;
    images.push({ id, image, caption: str(s.caption), subcaption: str(s.subcaption), href });
  }
  return images;
}

const pick = (v: unknown, allowed: readonly string[], fallback: string): string => (typeof v === 'string' && allowed.includes(v) ? v : fallback);

/** The gallery's root classes: layout, image shape and hover behaviour; unknown values use the schema defaults. */
export function galleryClass(settings: Record<string, unknown>): string {
  const layout = pick(settings.layout, ['grid', 'masonry', 'strip'], 'grid');
  const shape = pick(settings.shape, ['square', 'portrait', 'natural'], 'square');
  const hover = pick(settings.hover, ['none', 'caption', 'caption-link'], 'caption');
  return `eng-gallery eng-gallery--${layout} eng-gallery--${shape} eng-gallery--hover-${hover}`;
}
