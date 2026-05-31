import type { MouseEvent } from 'react';

/**
 * Full document navigation for app-shell links when Next.js soft routing is stuck.
 * AuthContext uses the same approach after login (`window.location.replace`).
 */
export function commitShellNavigation(href: string): void {
  if (typeof window === 'undefined') return;
  const raw = href.trim();
  if (!raw || raw === '#') return;

  let targetPath: string;
  try {
    const url = raw.startsWith('http')
      ? new URL(raw)
      : new URL(raw, window.location.origin);
    targetPath = url.pathname + url.search;
  } catch {
    return;
  }

  const current = window.location.pathname + window.location.search;
  if (current === targetPath) return;

  window.location.assign(raw.startsWith('http') ? raw : targetPath);
}

/** True for a plain left-click (respect modifier / middle-click for new tab). */
export function isPlainPrimaryClick(e: MouseEvent): boolean {
  return (
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey
  );
}

/**
 * Use on shell `<Link>` clicks: prevent soft nav and commit a full navigation instead.
 */
export function handleShellNavClick(
  e: MouseEvent<HTMLAnchorElement>,
  href: string
): void {
  if (!isPlainPrimaryClick(e)) return;
  e.preventDefault();
  commitShellNavigation(href);
}
