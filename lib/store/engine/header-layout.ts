// Client-safe: pure helpers for the storefront header, no server imports.

export type StickyMode = 'none' | 'scroll_up' | 'always' | 'always_shrink';

/** Extra classes for the header root; only the non-default choices add a class. */
export function headerLayoutClasses(o: {
  logoPosition: 'left' | 'center';
  logoPositionMobile: 'left' | 'center';
  menuLayout: 'below' | 'inline';
  separator: boolean;
}): string {
  const out: string[] = [];
  if (o.logoPosition === 'center') out.push('hdr-logo-center');
  if (o.logoPositionMobile === 'center') out.push('hdr-mlogo-center');
  if (o.menuLayout === 'inline') out.push('hdr-inline');
  if (!o.separator) out.push('hdr-noline');
  return out.join(' ');
}

/** Logo width variables; 0 means "automatic" and sets nothing. */
export function logoWidthStyle(desktop: number, mobile: number): Record<string, string> {
  const style: Record<string, string> = {};
  if (desktop > 0) style['--logo-w'] = `${desktop}px`;
  if (mobile > 0) style['--logo-w-m'] = `${mobile}px`;
  return style;
}

const MIN_MOVE = 4;
const SHRINK_AT = 24;

/** Next hidden/shrunk state for a scroll position, given the previous one. */
export function stickyHeaderState(
  mode: StickyMode,
  y: number,
  lastY: number,
  headerH: number,
  prev: { hidden: boolean; shrunk: boolean },
): { hidden: boolean; shrunk: boolean } {
  if (mode === 'always_shrink') {
    return { hidden: false, shrunk: y > SHRINK_AT };
  }
  if (mode !== 'scroll_up') {
    return { hidden: false, shrunk: false };
  }
  // Always visible near the top of the page.
  if (y < headerH) return { hidden: false, shrunk: false };
  const delta = y - lastY;
  if (Math.abs(delta) < MIN_MOVE) return { hidden: prev.hidden, shrunk: false };
  return { hidden: delta > 0, shrunk: false };
}
