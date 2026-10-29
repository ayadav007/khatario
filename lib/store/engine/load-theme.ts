import { queryOne } from '@/lib/db';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { sanitizeThemeData } from './sanitize';
import { getLiveTheme, getTheme } from './themes-repo';
import { verifyThemePreview } from './preview-token';
import type { ThemeRow } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(row: ThemeRow): ThemeRow {
  return { ...row, data: sanitizeThemeData(row.data) };
}

/** A preview needs a genuine token for this business, for exactly the requested theme, which must still exist. */
async function previewTheme(store: StoreBusinessContext, previewId: string | null | undefined, token: string | null | undefined) {
  if (!previewId || !token || !UUID.test(previewId)) return null;
  let verified: string | null = null;
  try {
    verified = verifyThemePreview(token, store.business_id);
  } catch {
    return null; // no signing secret configured: treat as no valid preview
  }
  if (!verified || verified.toLowerCase() !== previewId.toLowerCase()) return null;
  return getTheme(store.business_id, previewId);
}

export async function loadEngineTheme(
  store: StoreBusinessContext,
  params: { preview_theme?: string | null; pt?: string | null },
): Promise<{ theme: ThemeRow; preview: boolean } | null> {
  if (store.is_demo) return null;

  const previewed = await previewTheme(store, params.preview_theme, params.pt);
  if (previewed) return { theme: clean(previewed), preview: true };

  const flag = await queryOne<{ store_engine: boolean | null }>(
    `SELECT store_engine FROM business_settings WHERE business_id = $1`,
    [store.business_id],
  );
  if (!flag?.store_engine) return null;

  const live = await getLiveTheme(store.business_id);
  return live ? { theme: clean(live), preview: false } : null;
}
