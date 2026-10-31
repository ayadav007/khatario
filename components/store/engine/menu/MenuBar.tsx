'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { foldMenu, type ResolvedItem } from '@/lib/store/engine/menus';
import { MenuLink, MenuPanel } from './MenuPanel';
import './menu.css';

/** The editor asks the preview to hold a top item's dropdown open (`itemId: null` releases it). */
export const MENU_HOLD_EVENT = 'kh-menu-hold';

/** Open-state id of the "More" item; never a valid item id (those match `^[a-z0-9_-]+$`). */
const MORE = '#more';
const OPEN_DELAY = 150;
const CLOSE_DELAY = 300;

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function focusableLinks(panel: HTMLElement | null): HTMLElement[] {
  return panel ? Array.from(panel.querySelectorAll<HTMLElement>('a[href]')) : [];
}

/**
 * Desktop header menu (disclosure navigation pattern). A top item with a link keeps the label as a link and gets a
 * separate ▾ button; a heading without a link is the button itself. Every panel is in the server HTML, `hidden` until
 * opened. The inline layout folds items that do not fit into "More ▾".
 */
export function MenuBar({
  items,
  layout,
  caps,
  holdOpenId,
}: {
  items: ResolvedItem[];
  layout: 'below' | 'inline';
  caps: boolean;
  holdOpenId?: string | null;
}) {
  const uid = useId();
  const rootRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLUListElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const focusFirst = useRef<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [eventHeld, setEventHeld] = useState<string | null>(null);
  const [keep, setKeep] = useState(items.length);
  const [ready, setReady] = useState(false);

  const inline = layout === 'inline';
  const visible = inline ? Math.min(keep, items.length) : items.length;
  const overflow = items.slice(visible);
  const held = eventHeld ?? holdOpenId ?? null;
  const shown = held ?? openId;
  const moreOpen = shown === MORE || (shown !== null && overflow.some((i) => i.id === shown));
  const panelId = (id: string) => `${uid}-panel-${id}`;

  const clearTimer = () => window.clearTimeout(timer.current);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    const onHold = (e: Event) => {
      const id = (e as CustomEvent<{ itemId: string | null } | undefined>).detail?.itemId;
      setEventHeld(typeof id === 'string' ? id : null);
    };
    window.addEventListener(MENU_HOLD_EVENT, onHold);
    return () => window.removeEventListener(MENU_HOLD_EVENT, onHold);
  }, []);

  // Outside click closes.
  useEffect(() => {
    if (openId === null) return;
    const onDown = (e: globalThis.PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenId(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [openId]);

  // Opened from the keyboard with ArrowDown: move focus to the panel's first link.
  useEffect(() => {
    if (!shown || focusFirst.current !== shown) return;
    focusFirst.current = null;
    focusableLinks(document.getElementById(panelId(moreOpen ? MORE : shown)))[0]?.focus();
  });

  // Inline layout: measure every top item (an invisible copy) and fold what does not fit into "More".
  const sig = items.map((i) => `${i.label}${i.kind === 'link' ? '' : i.href ? '▾' : '▿'}`).join('|');
  useIsoLayoutEffect(() => {
    if (!inline) return;
    const root = rootRef.current;
    const measure = measureRef.current;
    if (!root || !measure) return;
    const run = () => {
      const kids = Array.from(measure.children) as HTMLElement[];
      const more = kids.pop();
      if (!more) return;
      const gap = parseFloat(getComputedStyle(measure).columnGap) || 0;
      const widths = kids.map((k) => k.getBoundingClientRect().width + gap);
      setKeep(foldMenu(widths, root.clientWidth + gap - 1, more.getBoundingClientRect().width + gap));
      setReady(true);
    };
    run();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(run);
    ro.observe(root);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [inline, sig, caps]);

  const toggle = (id: string) => {
    clearTimer();
    setOpenId((cur) => (cur === id ? null : id));
  };

  const onEnter = (id: string, hasPanel: boolean) => (e: PointerEvent) => {
    // A plain link leaves a pending close of the open item running.
    if (e.pointerType !== 'mouse' || !hasPanel) return;
    clearTimer();
    timer.current = window.setTimeout(() => setOpenId(id), OPEN_DELAY);
  };
  const onLeave = (id: string) => (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    clearTimer();
    timer.current = window.setTimeout(() => setOpenId((cur) => (cur === id ? null : cur)), CLOSE_DELAY);
  };
  const onToggleKey = (id: string) => (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault();
    clearTimer();
    if (shown === id || (id === MORE && moreOpen)) {
      focusableLinks(document.getElementById(panelId(id)))[0]?.focus();
      return;
    }
    focusFirst.current = id;
    setOpenId(id);
  };
  // Focus moving to another item (Tab) closes this one; focus going nowhere (a click on panel text) does not.
  const onBlur = (id: string) => (e: FocusEvent<HTMLLIElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && !e.currentTarget.contains(next)) setOpenId((cur) => (cur === id ? null : cur));
  };
  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = focusableLinks(e.currentTarget);
    if (!links.length) return;
    e.preventDefault();
    const at = links.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? Math.min(at + 1, links.length - 1) : Math.max(at - 1, 0);
    links[next]?.focus();
  };
  const onRootKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || openId === null) return;
    const id = openId;
    setOpenId(null);
    rootRef.current?.querySelector<HTMLElement>(`[data-kh-toggle="${id}"]`)?.focus();
  };

  const toggleButton = (id: string, label: string, open: boolean, withText: boolean, extra = '') => (
    <button
      type="button"
      className={withText ? `kh-top kh-toggle-label ${extra}` : 'kh-toggle'}
      aria-expanded={open}
      aria-controls={panelId(id)}
      aria-label={withText ? undefined : `${label} menu`}
      data-kh-toggle={id}
      onClick={() => toggle(id)}
      onKeyDown={onToggleKey(id)}
    >
      {withText ? label : null}
      <ChevronDown aria-hidden="true" />
    </button>
  );

  const rootClass = [
    'kh-menu',
    inline ? 'kh-menu-inline' : 'nav kh-menu-below',
    caps ? 'kh-menu-caps' : '',
    ready ? 'kh-ready' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <nav ref={rootRef} className={rootClass} aria-label="Main" onKeyDown={onRootKey}>
      <ul className="kh-menu-list">
        {items.map((item, i) => {
          const hasPanel = item.kind !== 'link';
          const open = hasPanel && shown === item.id && i < visible;
          const extra = item.highlight ? 'offers' : '';
          return (
            <li
              key={item.id}
              className={`kh-menu-item${item.kind === 'dropdown' ? ' kh-drop' : ''}`}
              hidden={i >= visible}
              onPointerEnter={onEnter(item.id, hasPanel)}
              onPointerLeave={onLeave(item.id)}
              onBlur={hasPanel ? onBlur(item.id) : undefined}
            >
              {item.href ? (
                <a className={`kh-top ${extra}`} href={item.href}>
                  {item.label}
                </a>
              ) : hasPanel ? null : (
                <span className={`kh-top ${extra}`}>{item.label}</span>
              )}
              {hasPanel ? toggleButton(item.id, item.label, open, !item.href, extra) : null}
              {hasPanel ? (
                <div
                  id={panelId(item.id)}
                  className={`kh-panel kh-panel-${item.kind}`}
                  hidden={!open}
                  onKeyDown={onPanelKey}
                >
                  <MenuPanel item={item} />
                </div>
              ) : null}
            </li>
          );
        })}
        {overflow.length ? (
          <li
            className="kh-menu-item kh-drop kh-more"
            onPointerEnter={onEnter(MORE, true)}
            onPointerLeave={onLeave(MORE)}
            onBlur={onBlur(MORE)}
          >
            {toggleButton(MORE, 'More', moreOpen, true)}
            <div id={panelId(MORE)} className="kh-panel kh-panel-dropdown" hidden={!moreOpen} onKeyDown={onPanelKey}>
              <ul className="kh-more-list">
                {overflow.map((item) => (
                  <li key={item.id}>
                    <MenuLink className="kh-more-top" label={item.label} href={item.href} />
                    {item.children.length ? (
                      <ul>
                        {item.children.map((child) => (
                          <li key={child.id}>
                            <MenuLink label={child.label} href={child.href} />
                            {child.children.length ? (
                              <ul>
                                {child.children.map((link) => (
                                  <li key={link.id}>
                                    <MenuLink label={link.label} href={link.href} />
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ) : null}
      </ul>
      {inline ? (
        <ul ref={measureRef} className="kh-menu-list kh-measure" aria-hidden="true">
          {items.map((item) => (
            <li key={item.id} className="kh-menu-item">
              {item.kind !== 'link' && !item.href ? (
                <span className="kh-top kh-toggle-label">
                  {item.label}
                  <ChevronDown />
                </span>
              ) : (
                <>
                  <span className="kh-top">{item.label}</span>
                  {item.kind === 'link' ? null : (
                    <span className="kh-toggle">
                      <ChevronDown />
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
          <li className="kh-menu-item">
            <span className="kh-top kh-toggle-label">
              More
              <ChevronDown />
            </span>
          </li>
        </ul>
      ) : null}
    </nav>
  );
}
