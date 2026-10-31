// Client-safe and pure. Which product card a storefront page shows.
import { isQuickPack, usesStudioSections, type StoreTheme } from '@/lib/store/store-theme';

/** Set by EngineShell from the engine theme's preset; null off the engine. */
export interface EngineCardLook {
  quick: boolean;
  phoneKit: boolean;
}

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
