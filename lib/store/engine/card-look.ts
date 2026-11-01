// Client-safe and pure. Which product card a storefront page shows.
import { isQuickPack, usesStudioSections, type StoreTheme } from '@/lib/store/store-theme';
import type { ProductCardSettings, ResolvedCardLook } from './product-card';
import type { ThemePreset } from './types';

/** Set by EngineShell from the engine theme's preset; null off the engine. */
export interface EngineCardLook {
  quick: boolean;
  phoneKit: boolean;
  /** Studio tiles show the product's tagline / colour swatches (a section can still override). */
  tagline: boolean;
  swatches: boolean;
  /** The store's own card design (Theme settings). A section's Card choice is resolved against it. */
  storeCard: ProductCardSettings;
  /** The card to draw here: the store's card, or the enclosing section's choice (`CardLookScope`). */
  card: ResolvedCardLook;
}

/** Which extra lines a preset's product tiles show: Heritage's boutique cards carry the tagline and colour swatches. */
export const PRESET_CARD_FIELDS: Record<ThemePreset, { tagline: boolean; swatches: boolean }> = {
  studio: { tagline: false, swatches: false },
  quick: { tagline: false, swatches: false },
  grocery: { tagline: false, swatches: false },
  khatario: { tagline: false, swatches: false },
  blank: { tagline: false, swatches: false },
  heritage: { tagline: true, swatches: true },
};

/**
 * On engine pages the engine preset decides the card, never the store's old design: every preset styles the
 * Studio tile, and Quick gets its ADD labels and option sheet. Off the engine the old design decides, as before.
 */
export function productCardLook(
  engine: EngineCardLook | null,
  theme: Pick<StoreTheme, 'pack' | 'phone_kit'>,
): { studioTile: boolean; quick: boolean; sheetsTheme: Pick<StoreTheme, 'pack' | 'phone_kit'> } {
  if (!engine) return { studioTile: usesStudioSections(theme), quick: isQuickPack(theme), sheetsTheme: theme };
  return {
    studioTile: true,
    quick: engine.quick,
    sheetsTheme: { pack: engine.quick ? 'quick' : 'studio', phone_kit: engine.phoneKit },
  };
}
