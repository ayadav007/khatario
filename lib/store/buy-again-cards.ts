// Client-safe and pure (lib/store/buy-again.ts reads the database, so the browser section cannot import it).
import { productCardPacks } from './engine/card-packs';

type BuyAgainCardInput = {
  id: string;
  has_variants?: boolean;
  selling_price: number;
  variants: ReadonlyArray<{ id: string; selling_price?: number | string | null }>;
  buy_again_variant_id: string | null;
};

/**
 * The Buy again cards to draw, in list order (newest first). A pack gets its own card only when the card shows that
 * pack as a chip (`packsLine` on, one option axis, the pack among the chips); otherwise every entry of that product
 * would look the same, so the product gets one card, from its newest entry.
 */
export function buyAgainCards<T extends BuyAgainCardInput>(items: T[], packsLine: boolean): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const chips = packsLine ? productCardPacks(item) : null;
    const variantId = item.buy_again_variant_id;
    const ownCard = !!variantId && !!chips?.packs.some((p) => p.id === variantId);
    const key = ownCard ? `${item.id}|${variantId}` : `${item.id}|`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
