// Client-safe and pure. The pack chips of the product card's `packs` line (500 g / 1 kg / 5 kg): the shopper picks one on
// the card and adds that exact pack, each pack its own cart line.
import { resolveVariant, variantOptions, type StoreVariantInput } from '../variant-options';
import type { StoreCartItem } from '../store-context';
import type { EngineCardLook } from './card-look';
import { isDesignedCard } from './card-render';

export interface CardPack {
  /** The variant id: the cart line is `(itemId, id)`. */
  id: string;
  /** The single axis's value for that variant ("1 kg", or the variant name when it has no attributes). */
  label: string;
  price: number;
  stock: number;
  soldOut: boolean;
}

/**
 * The packs of a product with exactly one option axis (any key: size, weight, or just the variant name), in variant order,
 * cut after `max` with the rest counted in `more`. With two axes or more (size and colour) a chip cannot name one variant,
 * so `packs` is empty and `axisCount` tells the card to fall back to its options button. Two variants with the same value
 * are one chip, the in-stock one first. A variant without a price gives 0; the card fills the product's price in first.
 */
export function cardPacks(
  variants: StoreVariantInput[],
  max = 4,
): { packs: CardPack[]; more: number; axisCount: number } {
  const list = variants ?? [];
  const axes = variantOptions(list);
  if (axes.length !== 1) return { packs: [], more: 0, axisCount: axes.length };
  const [axis] = axes;
  const all: CardPack[] = [];
  for (const { value } of axis.values) {
    const v = resolveVariant(list, { [axis.key]: value });
    if (!v) continue;
    const stock = v.current_stock;
    all.push({ id: v.id, label: value, price: v.selling_price ?? 0, stock, soldOut: !(stock > 0) });
  }
  const cut = Math.max(0, Math.floor(max));
  return { packs: all.slice(0, cut), more: Math.max(0, all.length - cut), axisCount: 1 };
}

/** The card shows the `packs` line: an engine page whose card design (not Theme's own) has that line on. */
export function packsLineOn(engineLook: Pick<EngineCardLook, 'card'> | null | undefined): boolean {
  return !!engineLook && isDesignedCard(engineLook.card) && engineLook.card.lines.some((l) => l.id === 'packs' && l.on);
}

/**
 * The pack chips a card with the `packs` line on draws for this product, or null when it draws none (no options, two
 * axes or more). A variant without its own price sells at the product's, as on the product page.
 */
export function productCardPacks(product: {
  has_variants?: boolean;
  selling_price: number;
  variants: ReadonlyArray<{ selling_price?: number | string | null }>;
}): ReturnType<typeof cardPacks> | null {
  if (!product.has_variants) return null;
  const variants = product.variants.map((v) => ({ ...v, selling_price: v.selling_price ?? product.selling_price }));
  const r = cardPacks(variants as unknown as StoreVariantInput[]);
  return r.axisCount === 1 && r.packs.length > 0 ? r : null;
}

/** The product's MRP belongs to its own price: a pack at another price (1 kg vs 500 g) shows no struck-through MRP. */
export function packPriceShowsMrp(packPrice: number, productPrice: number): boolean {
  return Number.isFinite(packPrice) && Number.isFinite(productPrice) && Math.abs(packPrice - productPrice) < 0.005;
}

/** The cart line of exactly this pack (`variantId` undefined: the product's own line with no variant). */
export function cartLineFor(cart: StoreCartItem[], itemId: string, variantId: string | undefined): StoreCartItem | undefined {
  return cart.find((c) => c.itemId === itemId && (variantId ? c.variantId === variantId : !c.variantId));
}
