// Server-only. What a storefront preview (`preview_theme` + `pt`) shows: a theme, or a published version (D47).
import { verifyPreviewToken } from './preview-token';
import { getTheme } from './themes-repo';
import { getVersion, versionAsTheme } from './versions-repo';
import type { ThemeRow } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The theme a preview link names, or null. The token must be genuine for this business, and its id must equal
 * `previewId` (case-insensitive). A theme token resolves to that theme while it exists; a version token to that
 * version shown as a read-only draft (`version: true`). The kind comes from the token, never from the URL, and both
 * lookups are scoped to the business. With no signing secret configured, there is no valid preview.
 */
export async function resolvePreviewTarget(
  businessId: string,
  previewId: string | null | undefined,
  pt: string | null | undefined,
): Promise<{ theme: ThemeRow; version: boolean } | null> {
  if (!previewId || !pt || !UUID.test(previewId)) return null;
  let target: ReturnType<typeof verifyPreviewToken> = null;
  try {
    target = verifyPreviewToken(pt, businessId);
  } catch {
    return null; // no signing secret configured
  }
  const id = previewId.toLowerCase();
  if (!target || target.id.toLowerCase() !== id) return null;
  if (target.kind === 'theme') {
    const theme = await getTheme(businessId, id);
    return theme ? { theme, version: false } : null;
  }
  const version = await getVersion(businessId, id);
  return version ? { theme: versionAsTheme(version), version: true } : null;
}
