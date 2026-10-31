'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import type { ResolvedItem } from '@/lib/store/engine/menus';
import { MenuLink, PanelPicture } from './MenuPanel';
import './menu.css';

/** Marks the history entry pushed when the panel opens, so Back closes it. */
const HISTORY_KEY = 'khMenuDrawer';
/** The Header section's scheme colours, carried into the portal. */
const SCHEME_VARS = ['--c-bg', '--c-text', '--c-accent', '--c-btn', '--c-btn-text', '--c-border', '--c-card'] as const;

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')).filter(
    (el) => el.getClientRects().length > 0,
  );
}

function historyToken(): unknown {
  try {
    return (window.history.state as Record<string, unknown> | null)?.[HISTORY_KEY];
  } catch {
    return undefined;
  }
}

function DrawerSub({ item }: { item: ResolvedItem }) {
  const picture = item.picture?.image ? <PanelPicture picture={item.picture} /> : null;
  if (item.kind === 'categories') {
    return (
      <>
        <ul className={`kh-drawer-cats${item.categoryPhotos ? ' photos' : ''}`}>
          {(item.categories ?? []).map((c) => (
            <li key={c.id}>
              <a href={`/catalog/${encodeURIComponent(c.id)}`}>
                {item.categoryPhotos ? (
                  c.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="kh-cat-pic" src={c.image_url} alt="" loading="lazy" />
                  ) : (
                    <span className="kh-cat-pic" aria-hidden="true">
                      {Array.from(c.name)[0] ?? ''}
                    </span>
                  )
                ) : null}
                <span>{c.name}</span>
              </a>
            </li>
          ))}
        </ul>
        {picture}
      </>
    );
  }
  return (
    <>
      <ul className="kh-drawer-links">
        {item.children.map((child) =>
          child.children.length ? (
            <li key={child.id} className="kh-drawer-groupItem">
              <MenuLink className="kh-drawer-group" label={child.label} href={child.href} />
              <ul>
                {child.children.map((link) => (
                  <li key={link.id}>
                    <MenuLink label={link.label} href={link.href} />
                  </li>
                ))}
              </ul>
            </li>
          ) : (
            <li key={child.id}>
              <MenuLink label={child.label} href={child.href} />
            </li>
          ),
        )}
      </ul>
      {picture}
    </>
  );
}

/**
 * Phone side panel: slides in from the left over an overlay. Closes with ✕, an overlay tap, Esc or Back (opening
 * pushes a history entry); locks page scroll, keeps focus inside and returns it to the button that opened it. Items
 * with children expand in place; `initialOpenId` opens with that item expanded. Rendered in place on the server (so
 * its links are in the HTML), then portalled to the store root so no sticky or contained parent traps it.
 */
export function MenuDrawer({
  items,
  open,
  onClose,
  initialOpenId,
}: {
  items: ResolvedItem[];
  open: boolean;
  onClose(): void;
  initialOpenId?: string | null;
}) {
  const uid = useId();
  const markRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  /** A link in the panel was followed: leave the pushed entry alone instead of going back over the navigation. */
  const navigating = useRef(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [vars, setVars] = useState<CSSProperties>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    setHost(markRef.current?.closest<HTMLElement>('.st-root') ?? document.body);
  }, []);

  // Each opening starts from the requested item and the header's current colours.
  useIsoLayoutEffect(() => {
    if (!open) return;
    setExpanded(new Set(initialOpenId ? [initialOpenId] : []));
    const mark = markRef.current;
    if (mark) {
      const cs = getComputedStyle(mark);
      const next: Record<string, string> = {};
      for (const name of SCHEME_VARS) {
        const value = cs.getPropertyValue(name).trim();
        if (value) next[name] = value;
      }
      setVars(next as CSSProperties);
    }
  }, [open, initialOpenId]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    let pushed = false;
    try {
      // Keep the router's own state on the entry so going forward onto it later is a plain restore.
      window.history.pushState({ ...((window.history.state as object | null) ?? {}), [HISTORY_KEY]: token }, '');
      pushed = true;
    } catch {
      /* history blocked (sandboxed frame): Back just won't close the panel */
    }
    let popped = false;
    const onPop = () => {
      if (popped || historyToken() === token) return;
      popped = true;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables(panelRef.current);
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const at = list.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey ? at <= 0 : at === -1 || at === list.length - 1) {
        e.preventDefault();
        list[e.shiftKey ? list.length - 1 : 0].focus();
      }
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);

    closeRef.current?.focus({ preventScroll: true });
    const nav = navRef.current;
    const row = initialOpenId ? nav?.querySelector<HTMLElement>(`[data-kh-item="${initialOpenId}"]`) : null;
    if (nav) nav.scrollTop = row && row.offsetTop + row.offsetHeight > nav.clientHeight ? row.offsetTop : 0;

    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      // Closed by ✕, overlay or Esc: take back the entry we pushed, but only while it is still the current one.
      if (pushed && !popped && !navigating.current && historyToken() === token) window.history.back();
      navigating.current = false;
      if (opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
    };
    // initialOpenId is read once per opening; the panel is reopened to change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onNavClick = (e: MouseEvent<HTMLElement>) => {
    if (!(e.target as Element).closest('a[href]')) return;
    navigating.current = true;
    onClose();
  };

  const subId = (id: string) => `${uid}-sub-${id}`;

  const drawer = (
    <div className="kh-drawer-wrap" hidden={!open} style={vars}>
      <div className="kh-drawer-scrim" aria-hidden="true" onClick={onClose} />
      <div ref={panelRef} className="kh-drawer" role="dialog" aria-modal="true" aria-label="Menu">
        <div className="kh-drawer-head">
          <b>Menu</b>
          <button ref={closeRef} type="button" className="kh-drawer-close" aria-label="Close menu" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        <nav ref={navRef} className="kh-drawer-nav" aria-label="Menu" onClick={onNavClick}>
          <ul>
            {items.map((item) => {
              const hasSub = item.kind !== 'link';
              const isOpen = hasSub && expanded.has(item.id);
              const offers = item.highlight ? ' offers' : '';
              return (
                <li key={item.id} className="kh-drawer-item" data-kh-item={item.id}>
                  {!hasSub ? (
                    <MenuLink className={`kh-drawer-link${offers}`} label={item.label} href={item.href} />
                  ) : item.href ? (
                    <div className="kh-drawer-split">
                      <a className={`kh-drawer-link${offers}`} href={item.href}>
                        {item.label}
                      </a>
                      <button
                        type="button"
                        className="kh-drawer-exp"
                        aria-expanded={isOpen}
                        aria-controls={subId(item.id)}
                        aria-label={`${item.label} menu`}
                        onClick={() => toggle(item.id)}
                      >
                        <ChevronDown aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`kh-drawer-link${offers}`}
                      aria-expanded={isOpen}
                      aria-controls={subId(item.id)}
                      onClick={() => toggle(item.id)}
                    >
                      {item.label}
                      <ChevronDown aria-hidden="true" />
                    </button>
                  )}
                  {hasSub ? (
                    <div id={subId(item.id)} className="kh-drawer-sub" hidden={!isOpen}>
                      <DrawerSub item={item} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );

  return (
    <>
      <span ref={markRef} hidden />
      {host ? createPortal(drawer, host) : drawer}
    </>
  );
}
