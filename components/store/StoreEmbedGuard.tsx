'use client';

import { useEffect } from 'react';
import { embedGuardOn } from '@/lib/store/engine/links';

const INTERACTIVE = 'a,button,input,select,textarea,summary,[role="button"],[role="link"]';

/**
 * A theme demo store inside the theme store's preview (`?embed=1`, or any frame): marks the page `eng-embed` (which
 * hides the Preview pill) and stops every click, form submit, drop-down and Enter/Space on a control, so the preview
 * scrolls but never navigates or adds to the cart. Decided from the address alone (embedGuardOn), so it holds as soon
 * as the page wakes up; real stores and a demo store opened directly are untouched.
 */
export function StoreEmbedGuard() {
  useEffect(() => {
    let framed = true;
    try {
      framed = window.self !== window.top;
    } catch {
      /* a cross-origin parent: framed */
    }
    if (!embedGuardOn({ host: window.location.host, search: window.location.search, framed })) return;
    const root = document.documentElement;
    root.classList.add('eng-embed');
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof Element && e.target.closest(INTERACTIVE)) stop(e);
    };
    // A drop-down opens on mousedown, before any click.
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest('select')) stop(e);
    };
    const opts = { capture: true };
    window.addEventListener('click', stop, opts);
    window.addEventListener('auxclick', stop, opts);
    window.addEventListener('submit', stop, opts);
    window.addEventListener('keydown', onKey, opts);
    window.addEventListener('mousedown', onDown, opts);
    return () => {
      root.classList.remove('eng-embed');
      window.removeEventListener('click', stop, opts);
      window.removeEventListener('auxclick', stop, opts);
      window.removeEventListener('submit', stop, opts);
      window.removeEventListener('keydown', onKey, opts);
      window.removeEventListener('mousedown', onDown, opts);
    };
  }, []);
  return null;
}
