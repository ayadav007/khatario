import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { loadEngineTheme } from './load-theme';
import { collectDataRequests, resolveSectionData, type SectionData } from './section-data';
import type { ThemeRow } from './types';

export type HomeSearchParams = Record<string, string | string[] | undefined>;

export interface EngineHome {
  theme: ThemeRow;
  preview: boolean;
  data: Record<string, SectionData>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s : null;
}

/**
 * The engine theme and section data for the home page, or null to render the old catalog.
 * Any failure (DB down, flag column not migrated yet, …) also returns null, so the engine
 * can never take a store's home page down.
 */
export async function loadEngineHome(
  store: StoreBusinessContext,
  searchParams: HomeSearchParams,
): Promise<EngineHome | null> {
  try {
    const engine = await loadEngineTheme(store, {
      preview_theme: first(searchParams.preview_theme),
      pt: first(searchParams.pt),
    });
    if (!engine) return null;

    const { theme, preview } = engine;
    const home = theme.data.templates.home ?? { order: [], sections: {} };
    const requests = collectDataRequests([theme.data.header_group, home, theme.data.footer_group]);
    // A malformed category id would fail the query and hide the grid, so it is ignored instead.
    const cat = first(searchParams.cat);
    const q = first(searchParams.q)?.trim().slice(0, 100) || null;
    const data = await resolveSectionData(store, requests, {
      categoryId: cat && UUID.test(cat) ? cat : null,
      search: q,
    });
    return { theme, preview, data };
  } catch (e) {
    console.error('[store engine]', store.store_subdomain, e instanceof Error ? e.message : e);
    return null;
  }
}
