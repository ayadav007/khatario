'use client';

import type { ReactNode } from 'react';
import { useFollowLink } from '../EngineViews';

/**
 * A Collage tile's link. The href is real (so it can be opened in a new tab), and a plain click follows it
 * the way the section's buttons do: client-side, keeping the theme preview params.
 */
export function CollageTileLink({ href, className, kind, ariaLabel, children }: { href: string; className: string; kind: string; ariaLabel?: string; children: ReactNode }) {
  const follow = useFollowLink();
  return (
    <a
      className={className}
      data-kind={kind}
      href={href}
      aria-label={ariaLabel}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        follow(href);
      }}
    >
      {children}
    </a>
  );
}
