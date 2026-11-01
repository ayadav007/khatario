'use client';

import { useEffect, useState } from 'react';
import type { StoreTheme } from './store-theme';

/** Phones: below the width where every theme's bottom tab bar disappears (Tailwind `sm`). */
export const PHONE_QUERY = '(max-width: 639px)';

/**
 * The phone kit (floating cart bar, bottom-sheet cart, options sheet, compact layouts) is built into
 * Quick and on by default for the other themes, which can switch it off in Studio.
 */
export function phoneKitEnabled(theme: Pick<StoreTheme, 'pack' | 'phone_kit'>): boolean {
  return theme.pack === 'quick' || theme.phone_kit !== false;
}

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(PHONE_QUERY);
    const apply = () => setPhone(mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);
  return phone;
}

/** True where the kit's sheets replace the theme's own drawers: always on Quick, on phones elsewhere. */
export function usePhoneSheets(theme: Pick<StoreTheme, 'pack' | 'phone_kit'>): boolean {
  const phone = useIsPhone();
  return theme.pack === 'quick' || (phone && phoneKitEnabled(theme));
}

/** Long search hints are cut on phones at the first comma: "Search for products, brands…" → "Search for products…". */
export function shortSearchHint(hint: string, max = 26): string {
  const h = hint.trim();
  if (h.length <= max) return h;
  const head = h.split(',')[0].replace(/[.…\s]+$/, '');
  return head.length <= max ? `${head}…` : 'Search…';
}
