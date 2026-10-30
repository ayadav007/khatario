// Typed glue between the public item API and the product sections (no React).
import type { StoreProduct } from '@/components/store/StoreProductCard';
import type { SizeChart, StoreTab } from '@/lib/store/product-extras';
import type { StoreVariant, StoreVariantInput } from '@/lib/store/variant-options';

/** The detail API's item: the card shape plus the product page extras. */
export type StoreProductDetail = StoreProduct & {
  video_url?: string | null;
  store_tabs?: StoreTab[] | null;
  size_chart?: SizeChart | null;
};

type RawVariant = { id: unknown; variant_name: unknown; selling_price: unknown; current_stock: unknown; attributes: unknown };

function numberish(v: unknown): number | string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return null;
}

/** String-valued attribute map; anything else (arrays, nested objects, blanks) is dropped. */
function attributesOf(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = String(v);
  }
  return Object.keys(out).length ? out : null;
}

/** API variants (attributes typed `unknown`) to the picker's input, in the same order. */
export function toVariantInputs(variants: ReadonlyArray<RawVariant> | null | undefined): StoreVariantInput[] {
  if (!Array.isArray(variants)) return [];
  return variants
    .filter((v) => v && v.id != null && String(v.id) !== '')
    .map((v) => ({
      id: String(v.id),
      variant_name: v.variant_name == null ? '' : String(v.variant_name),
      selling_price: numberish(v.selling_price),
      current_stock: numberish(v.current_stock),
      attributes: attributesOf(v.attributes),
    }));
}

/** One variant with numeric price and stock, or null when the id is not in the list. */
export function findVariant(variants: StoreVariantInput[], id: string | null | undefined): StoreVariant | null {
  if (!id) return null;
  const v = variants.find((x) => x.id === id);
  if (!v) return null;
  const price = v.selling_price == null || v.selling_price === '' ? null : Number(v.selling_price);
  const stock = Number(v.current_stock ?? 0);
  return {
    ...v,
    selling_price: price != null && Number.isFinite(price) ? price : null,
    current_stock: Number.isFinite(stock) ? stock : 0,
  };
}

export type ProductOffer = {
  price: number;
  /** MRP only when it is above the price. */
  mrp: number | null;
  /** Whole percent off MRP; 0 when there is no MRP discount. */
  percentOff: number;
  stock: number;
  /** False when sold out, or when a product with options has no option chosen. */
  canAdd: boolean;
};

/** Price, MRP and stock for the chosen variant (or the item when it has no options). */
export function productOffer(
  product: Pick<StoreProduct, 'selling_price' | 'mrp' | 'current_stock' | 'has_variants'>,
  variant: StoreVariant | null,
  variantCount: number,
): ProductOffer {
  const needsVariant = product.has_variants && variantCount > 0;
  const price = Number(variant?.selling_price ?? product.selling_price) || 0;
  const stock = needsVariant ? (variant ? variant.current_stock : 0) : Number(product.current_stock) || 0;
  const mrpRaw = product.mrp == null ? null : Number(product.mrp);
  const mrp = mrpRaw != null && Number.isFinite(mrpRaw) && mrpRaw > price ? mrpRaw : null;
  return {
    price,
    mrp,
    percentOff: mrp ? Math.round(((mrp - price) / mrp) * 100) : 0,
    stock,
    canAdd: stock > 0 && (!needsVariant || variant != null),
  };
}
