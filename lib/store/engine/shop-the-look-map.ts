import type { SectionData } from './section-data';
import type { Block, Section } from './types';
import type { StoreItem } from '@/lib/store/map-store-product';

// Client-safe and pure: the caller supplies each block's settings (the renderer passes `blockSettings`).

export type LookItem = {
  id: string;
  /** The pin number: 1..n over the hotspots whose product was found. */
  n: number;
  /** Pin position on the photo, percent, 0-100. */
  x: number;
  y: number;
  label: string;
  product: StoreItem;
  soldOut: boolean;
  /** Has options (sizes, colours): shoppers pick them on the product page instead of adding from here. */
  hasOptions: boolean;
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A percent setting: a number (or numeric text) clamped to 0-100, 50 when missing or not a number. */
function percent(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50;
}

/**
 * A Shop the look section's hotspots in block order. Skipped: disabled and unknown blocks, and hotspots whose
 * product was not found (so no pin and no list row); the rest are numbered 1..n.
 */
export function shopTheLookItems(
  section: Section,
  data: Pick<SectionData, 'productsById'>,
  settingsOf: (block: Block) => Record<string, unknown> | null,
): LookItem[] {
  const items: LookItem[] = [];
  for (const id of section.block_order ?? []) {
    const block = section.blocks?.[id];
    if (!block || block.disabled || block.type !== 'hotspot') continue;
    const s = settingsOf(block);
    if (!s) continue;
    const product = data.productsById?.[str(s.product)];
    if (!product) continue;
    items.push({
      id,
      n: items.length + 1,
      x: percent(s.x),
      y: percent(s.y),
      label: str(s.label).trim() || product.name,
      product,
      soldOut: product.current_stock <= 0 && !product.has_variants,
      hasOptions: !!product.has_variants,
    });
  }
  return items;
}

/**
 * The products "Add all to bag" adds: those that can be added straight from the section, once each (the same
 * product pinned twice counts once; the first hotspot wins).
 */
export function addableProducts(items: LookItem[]): StoreItem[] {
  const seen = new Set<string>();
  const out: StoreItem[] = [];
  for (const i of items) {
    if (i.soldOut || i.hasOptions || seen.has(i.product.id)) continue;
    seen.add(i.product.id);
    out.push(i.product);
  }
  return out;
}

/** What "Add all to bag" adds: the list prices of the addable products, each counted once. */
export function lookTotal(items: LookItem[]): number {
  return addableProducts(items).reduce((sum, p) => sum + p.selling_price, 0);
}
