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
