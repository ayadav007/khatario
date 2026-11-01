import type { SectionData } from './section-data';
import type { Block, Section } from './types';
import type { StoreItem } from '@/lib/store/map-store-product';
import { isVideoUrl } from '@/lib/store/theme-media-url';

// Client-safe and pure: the caller supplies each block's settings (the renderer passes `blockSettings`).

export type CollageTile = { id: string } & (
  | { kind: 'image'; image: string; video: boolean; caption: string; label: string; link: string }
  | { kind: 'product'; product: StoreItem; image: string }
  | { kind: 'category'; categoryId: string; name: string; image: string }
);

export type CollageMode = 'text' | 'text+tiles' | 'tiles' | 'empty';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * A Collage section's tiles in block order. Skipped: disabled and unknown blocks, image tiles with no image,
 * product tiles whose product was not found, category tiles whose category was not found.
 * A product or category tile's own image wins over the product photo or category picture.
 */
export function collageTiles(
  section: Section,
  data: Pick<SectionData, 'productsById' | 'categories'>,
  settingsOf: (block: Block) => Record<string, unknown> | null,
): CollageTile[] {
  const categories = new Map((data.categories ?? []).map((c) => [c.id, c]));
  const tiles: CollageTile[] = [];
  for (const id of section.block_order ?? []) {
    const block = section.blocks?.[id];
    if (!block || block.disabled) continue;
    const s = settingsOf(block);
    if (!s) continue;
    if (block.type === 'image_tile') {
      const image = str(s.image).trim();
      if (!image) continue;
      tiles.push({ id, kind: 'image', image, video: isVideoUrl(image), caption: str(s.caption), label: str(s.label), link: str(s.link).trim() });
    } else if (block.type === 'product_tile') {
      const product = data.productsById?.[str(s.product)];
      if (!product) continue;
      tiles.push({ id, kind: 'product', product, image: str(s.image).trim() || product.image_url || product.images?.[0] || '' });
    } else if (block.type === 'category_tile') {
      const category = categories.get(str(s.category));
      if (!category) continue;
      tiles.push({ id, kind: 'category', categoryId: category.id, name: category.name, image: str(s.image).trim() || category.image_url || '' });
    }
  }
  return tiles;
}

/** What the Collage draws: a text layout always shows its text; the tiles-only layout needs at least one tile. */
export function collageMode(layout: string, tileCount: number): CollageMode {
  if (layout === 'tiles') return tileCount > 0 ? 'tiles' : 'empty';
  return tileCount > 0 ? 'text+tiles' : 'text';
}
