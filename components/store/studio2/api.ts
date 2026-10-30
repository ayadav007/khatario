// Fetch helpers for the Studio 2 editor. The server takes the business and user from the session;
// business_id is sent the way the rest of the settings UI sends it (body for writes, query otherwise).
import type { ThemeData, ThemeRow } from '@/lib/store/engine/types';
import type { PutResult } from '@/lib/store/engine/editor/save-queue';

const BASE = '/api/settings/online-store/themes';

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

export async function fetchTheme(businessId: string, id: string): Promise<ThemeRow> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}?business_id=${encodeURIComponent(businessId)}`, {
    credentials: 'include',
  });
  const body = await readJson(res);
  const theme = res.ok ? themeOf(body) : null;
  if (!theme) throw new Error(errorOf(body, 'Failed to load theme'));
  return theme;
}

/** Throws on a network failure (the save queue treats that as offline). */
export async function putTheme(businessId: string, id: string, data: ThemeData, updatedAt: string): Promise<PutResult> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_id: businessId, data, updated_at: updatedAt }),
  });
  return { status: res.status, body: (await readJson(res)) as PutResult['body'] };
}

export async function publishTheme(businessId: string, id: string): Promise<ThemeRow> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}/publish?business_id=${encodeURIComponent(businessId)}`, {
    method: 'POST',
    credentials: 'include',
  });
  const body = await readJson(res);
  const theme = res.ok ? themeOf(body) : null;
  if (!theme) throw new Error(errorOf(body, 'Failed to publish theme'));
  return theme;
}

export async function openWorkingDraft(businessId: string): Promise<ThemeRow> {
  const res = await fetch(`${BASE}/working-draft`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_id: businessId }),
  });
  const body = await readJson(res);
  const theme = res.ok ? themeOf(body) : null;
  if (!theme) throw new Error(errorOf(body, 'Failed to open the working draft'));
  return theme;
}

export async function previewLink(businessId: string, id: string, kind: 'editor' | 'share'): Promise<string> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}/preview-link`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_id: businessId, kind }),
  });
  const body = await readJson(res);
  if (!res.ok || typeof body.url !== 'string') throw new Error(errorOf(body, 'Failed to create preview link'));
  return body.url;
}

export async function fetchCategories(businessId: string, userId: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(
    `/api/categories?business_id=${encodeURIComponent(businessId)}&user_id=${encodeURIComponent(userId)}`,
    { credentials: 'include' },
  );
  const body = await readJson(res);
  const rows = Array.isArray(body.categories) ? body.categories : [];
  return rows
    .filter((c): c is { id: string; name: string } => !!c && typeof c.id === 'string' && typeof c.name === 'string')
    .map((c) => ({ id: c.id, name: c.name }));
}

export function editorPath(id: string): string {
  return `/settings/online-store/themes/${encodeURIComponent(id)}/editor`;
}
