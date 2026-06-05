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
 * Legacy hook for shell `<Link>` clicks — no-op so Next.js handles soft routing.
 * Kept for call sites that may pass extra click logic alongside navigation.
 */
export function handleShellNavClick(
  _e: MouseEvent<HTMLAnchorElement>,
  _href: string
): void {
  // Intentionally empty: <Link> performs client-side navigation.
}
