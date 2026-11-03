// Client-safe and pure. The badges on a Studio product tile.
import { isNewArrival } from '@/lib/store/map-store-product';
import type { StudioBadge } from '@/lib/store/studio-sections';

/**
 * A product's own badge replaces every automatic one, the discount included (`hideDiscount`). Without it the
 * automatic badges are the section's highlight (e.g. Bestseller), then New for a recent arrival.
 */
export function cardBadges(
  input: { customBadge?: string | null; highlight?: string; createdAt?: string | null; discountPct: number },
  now: number = Date.now(),
): { badges: StudioBadge[]; hideDiscount: boolean } {
  const custom = input.customBadge?.trim();
  if (custom) return { badges: [{ label: custom, tone: 'hot' }], hideDiscount: true };
  return {
    badges: [
      ...(input.highlight ? [{ label: input.highlight, tone: 'hot' as const }] : []),
      ...(isNewArrival(input.createdAt, now) ? [{ label: 'New', tone: 'new' as const }] : []),
    ],
    hideDiscount: false,
  };
}

/**
 * The badge row and the strike-through decision of a Studio tile. `off` is the discount percent; the "% OFF" badge
 * comes first, and `hideDiscountBadge` drops only that badge: the struck-through MRP follows `off` alone. With
 * `format: 'rupees'` and `rupeesOff` above zero the badge reads "₹91 OFF" instead; without rupees it keeps the percent.
 */
export function tileBadges(
  off: number,
  badges: StudioBadge[],
  hideDiscountBadge = false,
  opts: { rupeesOff?: number; format?: 'percent' | 'rupees' } = {},
): { badges: StudioBadge[]; struck: boolean } {
  const rupees = opts.format === 'rupees' && opts.rupeesOff != null && opts.rupeesOff > 0 ? Math.round(opts.rupeesOff) : 0;
  const label = rupees > 0 ? `₹${rupees.toLocaleString('en-IN')} OFF` : `${off}% OFF`;
  const sale: StudioBadge[] = off > 0 && !hideDiscountBadge ? [{ label, tone: 'sale' }] : [];
  return { badges: [...sale, ...badges], struck: off > 0 };
}
