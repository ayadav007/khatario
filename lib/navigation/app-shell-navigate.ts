import type { MouseEvent } from 'react';

type ShellNavigateFn = (href: string) => void;

let shellNavigate: ShellNavigateFn | null = null;

/** Registered once from app shell layout so imperative callers can use router.push. */
export function registerShellNavigate(fn: ShellNavigateFn | null): void {
  shellNavigate = fn;
}

function resolveTargetPath(href: string): string | null {
  const raw = href.trim();
  if (!raw || raw === '#') return null;

  try {
    const url = raw.startsWith('http')
      ? new URL(raw)
      : new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

/**
 * Client-side shell navigation (Next.js App Router).
 * Falls back to full navigation only before the shell bridge mounts.
 */
export function commitShellNavigation(href: string): void {
  if (typeof window === 'undefined') return;

  const targetPath = resolveTargetPath(href);
  if (!targetPath) return;

  const current = window.location.pathname + window.location.search;
  if (current === targetPath) return;

  if (shellNavigate) {
    shellNavigate(targetPath);
    return;
  }

  window.location.assign(targetPath);
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
 * Shell `<Link>` clicks: imperative soft nav via router.push (registered in layout).
 * Next.js default Link routing can stall when the shell main thread is busy.
 */
export function handleShellNavClick(
  e: MouseEvent<HTMLAnchorElement>,
  href: string
): void {
  if (!isPlainPrimaryClick(e)) return;
  e.preventDefault();
  commitShellNavigation(href);
}
