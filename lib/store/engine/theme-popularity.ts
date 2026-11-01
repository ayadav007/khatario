// Server-only: how many stores use each theme live, for the theme store's Popular order (never shown as numbers).
import { unstable_cache } from 'next/cache';
import { queryRows } from '@/lib/db';
import type { ThemePreset } from './types';

/** Live themes per preset across all stores (uncached; tests call it directly). */
export async function countLiveThemesByPreset(): Promise<Partial<Record<ThemePreset, number>>> {
  const rows = await queryRows<{ preset: ThemePreset; n: number }>(
    `SELECT preset, count(*)::int AS n FROM store_themes WHERE role = 'live' GROUP BY preset`,
  );
  return Object.fromEntries(rows.map((r) => [r.preset, r.n]));
}

const cached = unstable_cache(countLiveThemesByPreset, ['theme-popularity'], { revalidate: 3600 });

/** The counts, cached for an hour; empty (the list's own order) when they cannot be read. */
export async function themePopularity(): Promise<Partial<Record<ThemePreset, number>>> {
  try {
    return await cached();
  } catch (error) {
    console.error('[theme-popularity] counts unavailable', error);
    return {};
  }
}
