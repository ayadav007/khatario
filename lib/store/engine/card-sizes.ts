// Client-safe and pure. The size chips of the product card's `sizes` line: the product's size values, in variant order,
// cut after `max` with the rest counted.
import { variantOptions, type StoreVariantInput } from '../variant-options';

export interface CardSize {
  value: string;
  soldOut: boolean;
}

/**
 * The `size` axis of the variant picker (`variantOptions` reads any spelling of the key: Size, SIZE) as chips. Sizes typed
 * with different case (`l`, `L`) are one chip, named as first written; it is sold out only when every variant of it is at
 * zero. Variants with no size axis (colour only, or just a name) give no chips.
 */
export function cardSizes(variants: StoreVariantInput[], max = 6): { sizes: CardSize[]; more: number } {
  const axis = variantOptions(variants ?? []).find((a) => a.key === 'size');
  if (!axis) return { sizes: [], more: 0 };
  const all: CardSize[] = [];
  const at = new Map<string, number>();
  for (const { value, inStock } of axis.values) {
    const key = value.toLowerCase();
    const found = at.get(key);
    if (found === undefined) {
      at.set(key, all.length);
      all.push({ value, soldOut: !inStock });
    } else if (inStock) {
      all[found].soldOut = false;
    }
  }
  const cut = Math.max(0, Math.floor(max));
  return { sizes: all.slice(0, cut), more: Math.max(0, all.length - cut) };
}
