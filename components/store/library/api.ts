// Fetch helpers for the theme library and version history. The business and the user come from the
// session (no business_id is sent, so a stale id can never be used); the server never trusts one anyway.
import type { ThemeListRow, ThemePreset, ThemeRow, ThemeVersionSummary } from '@/lib/store/engine/types';

export { publishTheme, previewLink, openWorkingDraft, editorPath } from '@/components/store/studio2/api';

const BASE = '/api/settings/online-store/themes';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body = await res.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function errorOf(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === 'string' && body.error ? body.error : fallback;
}

function themeOf(body: Record<string, unknown>): ThemeRow | null {
  const t = body.theme as ThemeRow | undefined;
  return t && typeof t === 'object' && typeof t.id === 'string' ? t : null;
}

export async function listThemes(): Promise<ThemeListRow[]> {
  const res = await fetch(BASE, { credentials: 'include' });
  const body = await readJson(res);
  if (!res.ok || !Array.isArray(body.themes)) throw new Error(errorOf(body, 'Failed to load themes'));
  return body.themes as ThemeListRow[];
}

export async function createTheme(opts: {
  name?: string;
  preset?: ThemePreset;
  source?: 'preset' | 'migrated';
  duplicateOf?: string;
}): Promise<ThemeRow> {
  const payload: Record<string, unknown> = {};
  if (opts.name !== undefined) payload.name = opts.name;
  if (opts.preset !== undefined) payload.preset = opts.preset;
  if (opts.source !== undefined) payload.source = opts.source;
  if (opts.duplicateOf !== undefined) payload.duplicate_of = opts.duplicateOf;
  const res = await fetch(BASE, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  const theme = res.ok ? themeOf(body) : null;
  if (!theme) throw new Error(errorOf(body, 'Failed to create the theme'));
  return theme;
}

export async function renameTheme(id: string, name: string): Promise<ThemeRow> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  });
  const body = await readJson(res);
  const theme = res.ok ? themeOf(body) : null;
  if (!theme) throw new Error(errorOf(body, 'Failed to rename the theme'));
  return theme;
}

export async function deleteTheme(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new Error(errorOf(await readJson(res), 'Failed to delete the theme'));
}

/** Discard changes (D41): the working draft matches the live theme again. */
export async function resetWorkingDraft(): Promise<ThemeRow> {
  const res = await fetch(`${BASE}/working-draft/reset`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: '{}',
  });
  const body = await readJson(res);
  const theme = res.ok ? themeOf(body) : null;
  if (!theme) throw new Error(errorOf(body, 'Failed to discard the changes'));
  return theme;
}

export async function listVersions(): Promise<ThemeVersionSummary[]> {
  const res = await fetch(`${BASE}/versions`, { credentials: 'include' });
  const body = await readJson(res);
  if (!res.ok || !Array.isArray(body.versions)) throw new Error(errorOf(body, 'Failed to load the version history'));
  return body.versions as ThemeVersionSummary[];
}

/** Restore as draft (D48): a new draft; the live theme is untouched. */
export async function restoreVersion(vid: string): Promise<ThemeRow> {
  const res = await fetch(`${BASE}/versions/${encodeURIComponent(vid)}/restore`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: '{}',
  });
  const body = await readJson(res);
  const theme = res.ok ? themeOf(body) : null;
  if (!theme) throw new Error(errorOf(body, 'Failed to restore the version'));
  return theme;
}

/** A two-hour read-only link to one version of the store. */
export async function versionPreviewLink(vid: string, path = '/'): Promise<string> {
  const res = await fetch(`${BASE}/versions/${encodeURIComponent(vid)}/preview-link`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ path }),
  });
  const body = await readJson(res);
  if (!res.ok || typeof body.url !== 'string') throw new Error(errorOf(body, 'Failed to create the preview link'));
  return body.url;
}
