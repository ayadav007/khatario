import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { loadEngineTheme } from './load-theme';
import { collectDataRequests, resolveSectionData, type SectionData } from './section-data';
import type { PageTemplate, ThemeRow } from './types';

export type HomeSearchParams = Record<string, string | string[] | undefined>;

export interface EnginePage {
  theme: ThemeRow;
  preview: boolean;
  /** Studio 2 editor mode: a verified preview opened with `editor=1`. */
  editor: boolean;
  /** The requested template, or null when the theme has no template under that key. */
  template: PageTemplate | null;
  /** Section data for the header group, the template and the footer group. */
  data: Record<string, SectionData>;
}

// A store theme migration that has not run yet fails every request the same way; log it once per process.
let loggedMissingMigration = false;

/** D15: a product or catalog template with no enabled section renders the classic page instead. */
export function hasEnabledSection(template: PageTemplate | null | undefined): boolean {
  return !!template?.order.some((id) => {
    const section = template.sections[id];
    return !!section && !section.disabled;
  });
}

/** A search-params record as a query string (`?a=1&b=2`, or '' when empty); repeated keys keep every value. */
export function searchString(searchParams: HomeSearchParams): string {
  const out = new URLSearchParams();
  for (const [key, v] of Object.entries(searchParams)) {
    for (const value of Array.isArray(v) ? v : [v]) if (typeof value === 'string') out.append(key, value);
  }
  const qs = out.toString();
  return qs ? `?${qs}` : '';
}

export function first(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s : null;
}

/**
 * The engine theme, one template and its section data, or null to render the old storefront.
 * Any failure (DB down, flag column not migrated yet, …) also returns null, so the engine
 * can never take a store page down.
 */
export async function loadEnginePage(
  store: StoreBusinessContext,
  searchParams: HomeSearchParams,
  templateKey: string,
  narrow?: { categoryId?: string | null; search?: string | null },
): Promise<EnginePage | null> {
  try {
    const engine = await loadEngineTheme(store, {
      preview_theme: first(searchParams.preview_theme),
      pt: first(searchParams.pt),
    });
    if (!engine) return null;

    const { theme, preview } = engine;
    const template = theme.data.templates[templateKey] ?? null;
    const requests = collectDataRequests([
      theme.data.header_group,
      template ?? { order: [], sections: {} },
      theme.data.footer_group,
    ]);
    const data = await resolveSectionData(store, requests, {
      categoryId: narrow?.categoryId ?? null,
      search: narrow?.search ?? null,
    });
    const editor = preview && first(searchParams.editor) === '1';
    return { theme, preview, editor, template, data };
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    const missingMigration = code === '42703' || code === '42P01';
    if (!missingMigration || !loggedMissingMigration) {
      if (missingMigration) loggedMissingMigration = true;
      console.error('[store engine]', store.store_subdomain, e instanceof Error ? e.message : e);
    }
    return null;
  }
}
