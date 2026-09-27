'use client';

import { useEffect, useMemo, useState, type RefObject } from 'react';
import { Search } from 'lucide-react';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { storeDraftToken } from '@/lib/store/store-context';
import type { StoreTheme } from '@/lib/store/store-theme';
import type { StudioSection, StudioSettings } from '@/lib/store/studio-sections';
import { resolveStudioSections, splitList, studioLinkTarget, type StudioLinkTarget } from '@/lib/store/studio-layout';
import { StudioAnnouncement, StudioFooter, StudioHeader, type StudioLink } from './StudioSections';

export interface StudioNavCategory {
  id: string;
  name: string;
}

export function useStudioSections(
  theme: StoreTheme,
  store: StoreBusinessContext | null,
  categories: StudioNavCategory[],
): StudioSection[] {
  const name = store?.name ?? '';
  const tagline = store?.store_tagline ?? '';
  const heroUrl = store?.store_hero_image_url ?? '';
  return useMemo(
    () => resolveStudioSections(theme, { businessName: name, tagline, heroUrl, categories, autoAnnouncement: '' }),
    [theme, name, tagline, heroUrl, categories],
  );
}

export function studioSettings(sections: StudioSection[], type: StudioSection['type']): StudioSettings | null {
  const s = sections.find((x) => x.type === type && x.enabled);
  return s ? s.settings : null;
}

/** Draft token is read after mount so server and client markup agree. */
function useDraftToken(): string | null {
  const [td, setTd] = useState<string | null>(null);
  useEffect(() => setTd(storeDraftToken()), []);
  return td;
}

function withDraft(href: string, td: string | null): string {
  if (!td || !href.startsWith('/')) return href;
  return `${href}${href.includes('?') ? '&' : '?'}td=${encodeURIComponent(td)}`;
}

/** Off the home page, unknown labels go home and CatalogView resolves them once categories load. */
function targetHref(target: StudioLinkTarget, label: string): string {
  if (target.kind === 'href') return target.href;
  if (target.kind === 'category') return `/?category=${encodeURIComponent(target.id)}`;
  if (target.kind === 'offers') return '/?offers=1';
  return `/?nav=${encodeURIComponent(label)}`;
}

export interface StudioNavState {
  categoryId: string | null;
  offers: boolean;
}

export function StudioStoreHeader({
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
}) {
  const td = useDraftToken();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const announce = studioSettings(sections, 'announcement');
  const header = studioSettings(sections, 'header') ?? { logo: store.name };

  const nav: StudioLink[] = splitList(header.navLinks, 'All Products').map((label) => {
    const target = studioLinkTarget(label, categories);
    const active =
      (target.kind === 'category' && navState?.categoryId === target.id) ||
      (target.kind === 'offers' && !!navState?.offers);
    if (onNavigate && target.kind !== 'href') {
      return { label, active, onClick: () => onNavigate(target, label) };
    }
    return { label, active, href: withDraft(targetHref(target, label), td) };
  });

  const search =
    showSearch && onSearchChange ? (
      <div className="search" role="search">
        <Search />
        <input
          id="store-search"
          ref={searchRef}
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && searchQuery) {
              e.preventDefault();
              onSearchChange('');
            }
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          enterKeyHint="search"
          autoComplete="off"
        />
        {searchQuery ? (
          <button type="button" className="clear" onClick={() => onSearchChange('')} aria-label="Clear search">
            Clear
          </button>
        ) : null}
      </div>
    ) : (
      <a className="search" href={withDraft('/', td)} onClick={(e) => {
        if (!showSearch) return;
        e.preventDefault();
        searchRef.current?.focus();
      }}>
        <Search />
        <span>{searchPlaceholder}</span>
      </a>
    );

  return (
    <div className={`st-sticky st-cq ${scrolled ? 'scrolled' : ''}`}>
      {announce && (announce.text || announce.autoText) ? <StudioAnnouncement s={announce} live /> : null}
      <StudioHeader
        s={{ ...header, logo: header.logo || store.name }}
        logoUrl={logoUrl}
        search={search}
        nav={nav}
        cartCount={cartCount}
        onCart={onCart}
        accountHref={withDraft('/account', td)}
        homeHref={withDraft('/', td)}
      />
    </div>
  );
}

export function StudioStoreFooter({
  sections,
  store,
  theme,
  categories,
  hideBadge,
}: {
  sections: StudioSection[];
  store: StoreBusinessContext;
  theme: StoreTheme;
  categories: StudioNavCategory[];
  hideBadge: boolean;
}) {
  const td = useDraftToken();
  const footer = studioSettings(sections, 'footer');
  if (!footer) return null;
  const links: StudioLink[] = splitList(footer.links, 'Shop, About, Contact, Privacy').map((label) => {
    const key = label.trim().toLowerCase();
    const target = key === 'shop' ? ({ kind: 'href', href: '/' } as const) : studioLinkTarget(label, categories);
    return { label, href: withDraft(targetHref(target, label), td) };
  });
  if (theme.instagram_url) links.push({ label: 'Instagram', href: theme.instagram_url });
  if (theme.whatsapp_url) links.push({ label: 'WhatsApp', href: theme.whatsapp_url });
  return (
    <div className="st-cq">
      <StudioFooter
        s={{ ...footer, brand: footer.brand || store.name }}
        links={links}
        badge={hideBadge ? undefined : 'Powered by Khatario'}
      />
    </div>
  );
}
