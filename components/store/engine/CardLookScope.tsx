'use client';

import { useMemo, type ReactNode } from 'react';
import { resolveCardLook } from '@/lib/store/engine/product-card';
import { EngineCardContext, useEngineCardLook } from './EngineCardContext';

/** A section's own line switches (`show_rating` and friends); an omitted one leaves that line to the design. */
export interface CardLookSwitches {
  rating?: boolean;
  badges?: boolean;
  tagline?: boolean;
  swatches?: boolean;
}

/**
 * Wraps a section's product cards. Re-resolves the card for this section: its Card choice (`store` or empty keeps the
 * store's card design, a design id uses that design) with the section's switches folded in. Off the engine it does nothing.
 */
export function CardLookScope({
  design,
  switches,
  children,
}: {
  design?: string;
  switches?: CardLookSwitches;
  children: ReactNode;
}) {
  const parent = useEngineCardLook();
  const { rating, badges, tagline, swatches } = switches ?? {};
  const value = useMemo(
    () => (parent ? { ...parent, card: resolveCardLook(parent.storeCard, design, { rating, badges, tagline, swatches }) } : null),
    [parent, design, rating, badges, tagline, swatches],
  );
  if (!value) return <>{children}</>;
  return <EngineCardContext.Provider value={value}>{children}</EngineCardContext.Provider>;
}
