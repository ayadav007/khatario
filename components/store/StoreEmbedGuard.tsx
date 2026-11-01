'use client';

import { useEffect } from 'react';
import { isEmbedSearch } from '@/lib/store/engine/links';

const INTERACTIVE = 'a,button,input,select,textarea,summary,[role="button"],[role="link"]';

/**
 * A theme demo store inside the theme store's preview frame (`?embed=1`): marks the page `eng-embed` (which hides the
 * Preview pill) and stops every click, form submit and Enter/Space on a control, so the preview scrolls but never
 * navigates or adds to the cart. Real stores and a demo store opened directly are untouched.
 */
export function StoreEmbedGuard({ isDemo }: { isDemo: boolean }) {
  useEffect(() => {
    if (!isDemo || !isEmbedSearch(window.location.search)) return;
    const root = document.documentElement;
    root.classList.add('eng-embed');
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof Element && e.target.closest(INTERACTIVE)) stop(e);
    };
    const opts = { capture: true };
    window.addEventListener('click', stop, opts);
    window.addEventListener('auxclick', stop, opts);
    window.addEventListener('submit', stop, opts);
    window.addEventListener('keydown', onKey, opts);
    return () => {
      root.classList.remove('eng-embed');
      window.removeEventListener('click', stop, opts);
      window.removeEventListener('auxclick', stop, opts);
      window.removeEventListener('submit', stop, opts);
      window.removeEventListener('keydown', onKey, opts);
    };
  }, [isDemo]);
  return null;
}
