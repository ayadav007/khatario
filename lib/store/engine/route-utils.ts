import { NextResponse } from 'next/server';
import type { RepoResult } from './themes-repo';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The permission a theme or version GET needs: settings read OR update (D53). The role API can store
 * update without view, and such staff must still open the library and the editor.
 */
export const THEME_READ = ['read', 'update'] as const;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

const FAILURES = {
  not_found: { status: 404, error: 'Theme not found' },
  conflict: { status: 409, error: 'This theme was changed elsewhere. Reload and try again.' },
  limit: { status: 409, error: 'Theme limit reached. Delete a draft theme first.' },
  too_large: { status: 413, error: 'Theme is too large.' },
  live_locked: { status: 409, error: 'The live theme cannot be changed this way. Edit a draft and publish it.' },
  working_locked: { status: 409, error: 'This is the copy the editor works on. Use Discard changes instead.' },
  no_store_design: { status: 409, error: 'There is no store design to copy yet.' },
} as const;

export function repoFailure(code: keyof typeof FAILURES): NextResponse {
  const f = FAILURES[code];
  return NextResponse.json({ error: f.error, code }, { status: f.status });
}

/** JSON `{ <key>: value }` on success, mapped error response otherwise. */
export function repoJson<T>(result: RepoResult<T>, key: string, status = 200): NextResponse {
  return result.ok ? NextResponse.json({ [key]: result.value }, { status }) : repoFailure(result.code);
}

export const notFound = () => repoFailure('not_found');
