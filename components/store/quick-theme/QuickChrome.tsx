'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronRight, Home, LayoutGrid, MapPin, Search, ShoppingCart, User, X } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import type { StudioSection } from '@/lib/store/studio-sections';
import { sanitizeStoreTheme, storePackClass } from '@/lib/store/store-theme';
import { splitList, studioLinkTarget, studioThemeVars, type StudioLinkTarget } from '@/lib/store/studio-layout';
import { freeDeliveryProgress } from '@/lib/store/quick';
import { StudioAnnouncement, StudioSectionFrame, rupees } from '../studio-theme/StudioSections';
import { studioSection, type StudioNavCategory, type StudioNavState } from '../studio-theme/StoreStudioChrome';
import './quick-theme.css';

/** Asks the home page to open the category view; other pages navigate there instead. */
export const BROWSE_CATEGORIES_EVENT = 'store:browse-categories';

export function browseCategories(onHome: boolean) {
  if (onHome) window.dispatchEvent(new Event(BROWSE_CATEGORIES_EVENT));
  else window.location.href = '/?browse=categories';
}

/** Rotating search hint built from the store's own categories. */
function useSearchHint(base: string, categories: StudioNavCategory[]): string {
  const names = categories.slice(0, 8).map((c) => c.name);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (names.length < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setI((n) => n + 1), 2600);
    return () => window.clearInterval(t);
  }, [names.length]);
  if (!names.length) return base;
  return `Search “${names[i % names.length]}”`;
}

export function QuickHeader({
  sections,
  store,
  logoUrl,
  categories,
  cartCount,
  onCart,
  showSearch,
  searchQuery,
  onSearchChange,
  searchRef,
  searchPlaceholder,
  onNavigate,
  navState,
  locationLine,
  onLocation,
}: {
  sections: StudioSection[];
  store: StoreBusinessContext;
  logoUrl: string | null;
  categories: StudioNavCategory[];
  cartCount: number;
  onCart: () => void;
  showSearch: boolean;
  searchQuery: string;
  onSearchChange?: (q: string) => void;
  searchRef: RefObject<HTMLInputElement>;
  searchPlaceholder: string;
  onNavigate?: (target: StudioLinkTarget, label: string) => void;
  navState?: StudioNavState;
  /** Second line of the location button, e.g. "Deliver to 560001". */
  locationLine: string;
  onLocation: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  // The category rail sticks just below the header, whatever height it ends up.
  useEffect(() => {
    const el = topRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--qk-head', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const announceSection = studioSection(sections, 'announcement');
  const headerSection = studioSection(sections, 'header');
  const announce = announceSection?.settings;
  const header = headerSection?.settings ?? {};
  const eta = header.deliveryEta?.trim();
  const name = header.logo || store.name;
  const hint = useSearchHint(searchPlaceholder, categories);
  const live = showSearch && !!onSearchChange;

  const chips = splitList(header.navLinks, '').map((label) => {
    const target = studioLinkTarget(label, categories);
    const active =
      (target.kind === 'category' && navState?.categoryId === target.id) || (target.kind === 'offers' && !!navState?.offers);
    return { label, target, active };
  });

  const body = (
    <div className="qk-head">
      <div className="qk-row">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="qk-logo" src={logoUrl} alt={name} />
        ) : null}
        <button type="button" className="qk-loc" onClick={onLocation} aria-label="Change delivery location">
          <b>{eta ? `Delivery ${eta}` : name}</b>
          <span>
            <MapPin aria-hidden="true" />
            {locationLine}
            <ChevronDown aria-hidden="true" />
          </span>
        </button>
        <div className="qk-actions">
          <Link href="/account" aria-label="Account">
            <User />
          </Link>
          <button type="button" className="qk-cartBtn" onClick={onCart} aria-label={cartCount ? `Cart, ${cartCount} items` : 'Cart'}>
            <ShoppingCart />
            {cartCount > 0 ? <sup>{cartCount}</sup> : null}
          </button>
        </div>
      </div>
      {header.showSearch === false ? null : (
        <div className="qk-search" role="search">
          <Search aria-hidden="true" />
          {live ? (
            <>
              <input
                id="store-search"
                ref={searchRef}
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchChange?.(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && searchQuery) {
                    e.preventDefault();
                    onSearchChange?.('');
                  }
                }}
                placeholder={hint}
                aria-label={searchPlaceholder}
                enterKeyHint="search"
                autoComplete="off"
              />
              {searchQuery ? (
                <button type="button" className="qk-clear" onClick={() => onSearchChange?.('')} aria-label="Clear search">
                  <X />
                </button>
              ) : null}
            </>
          ) : (
            <a href="/?focus=search">{hint}</a>
          )}
        </div>
      )}
      {header.showNav !== false && chips.length ? (
        <nav className="qk-chips" aria-label="Shop">
          {chips.map((c) =>
            onNavigate && c.target.kind !== 'href' ? (
              <button
                type="button"
                key={c.label}
                className={[c.active ? 'on' : '', c.target.kind === 'offers' ? 'offers' : ''].join(' ')}
                onClick={() => onNavigate(c.target, c.label)}
              >
                {c.label}
              </button>
            ) : (
              <a key={c.label} href={c.target.kind === 'href' ? c.target.href : '/'}>
                {c.label}
              </a>
            ),
          )}
        </nav>
      ) : null}
    </div>
  );

  return (
    <div ref={topRef} className={`qk-top st-cq ${scrolled ? 'scrolled' : ''}`}>
      {announceSection && announce && (announce.text || announce.autoText) ? (
        <StudioSectionFrame section={announceSection}>
          <StudioAnnouncement s={announce} live />
        </StudioSectionFrame>
      ) : null}
      {headerSection ? <StudioSectionFrame section={headerSection}>{body}</StudioSectionFrame> : body}
    </div>
  );
}

/** Bottom tab bar on phones. */
export function QuickTabs({ onSearch, onCart }: { onSearch: () => void; onCart: () => void }) {
  const pathname = usePathname();
  const { cartCount } = useStore();
  const home = pathname === '/' || pathname === '/store';
  const account = pathname === '/account' || pathname === '/store/account';
  return (
    <nav className="qk-tabs" aria-label="Store">
      <Link href="/" className={home ? 'on' : ''}>
        <Home />
        Home
      </Link>
      <button type="button" onClick={() => browseCategories(home)}>
        <LayoutGrid />
        Categories
      </button>
      <button type="button" onClick={onSearch}>
        <Search />
        Search
      </button>
      <button type="button" onClick={onCart}>
        <span className="qk-tabIcon">
          <ShoppingCart />
          {cartCount > 0 ? <sup>{cartCount}</sup> : null}
        </span>
        Cart
      </button>
      <Link href="/account" className={account ? 'on' : ''}>
        <User />
        Account
      </Link>
    </nav>
  );
}

/** Floating "n items · ₹total · View cart" bar with free-delivery progress. */
export function QuickCartBar({ freeAbove, onCart }: { freeAbove: number | null; onCart: () => void }) {
  const { cartCount, cartTotal } = useStore();
  if (cartCount <= 0) return null;
  const progress = freeDeliveryProgress(cartTotal, freeAbove);
  return (
    <div className="qk-cartBar">
      {progress ? (
        <div className="qk-free">
          <span>{progress.remaining > 0 ? `Add ${rupees(progress.remaining)} more for free delivery` : 'You get free delivery'}</span>
          <i style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
        </div>
      ) : null}
      <button type="button" onClick={onCart}>
        <span>
          <b>
            {cartCount} {cartCount === 1 ? 'item' : 'items'}
          </b>
          {rupees(cartTotal)}
        </span>
        <span className="qk-view">
          View cart <ChevronRight />
        </span>
      </button>
    </div>
  );
}

/** Bottom sheet used for location, variants and the cart. */
export function QuickSheet({
  open,
  onClose,
  title,
  children,
  footer,
  label,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  label: string;
}) {
  const { store } = useStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!mounted) return null;
  // Portalled to <body> so no transformed or scrolling parent can trap the fixed sheet;
  // the wrapper carries the store's colour tokens with it.
  const theme = sanitizeStoreTheme(store?.store_theme);
  return createPortal(
    <div className={`st-root ${storePackClass(theme)} qk-portal`} style={studioThemeVars(theme)}>
    <div className={`qk-sheetWrap ${open ? 'on' : ''}`} aria-hidden={!open}>
      <button type="button" className="qk-scrim" aria-label="Close" tabIndex={open ? 0 : -1} onClick={onClose} />
      <div className="qk-sheet" role="dialog" aria-modal="true" aria-label={label}>
        <div className="qk-sheetHead">
          <div>{title}</div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="qk-sheetBody">{open ? children : null}</div>
        {open && footer ? <div className="qk-sheetFoot">{footer}</div> : null}
      </div>
    </div>
    </div>,
    document.body,
  );
}
