'use client';

import { Search, MapPin, ChevronDown } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { StoreMobileNav } from './StoreMobileNav';
import { GroceryFooter, GroceryHeader, GroceryMarquee } from './StoreGroceryChrome';
import {
  StudioStoreFooter,
  StudioStoreHeader,
  useStudioSections,
  type StudioNavCategory,
  type StudioNavState,
} from './studio-theme/StoreStudioChrome';
import { chowkInkOn, chowkOnAccent, isGroceryPack, isKhatarioPack, sanitizeStoreTheme, storeCanvas, storeFontStack, storePackClass } from '@/lib/store/store-theme';
import { studioThemeVars, type StudioLinkTarget } from '@/lib/store/studio-layout';

interface StoreShellProps {
  children: React.ReactNode;
  onSearchChange?: (query: string) => void;
  searchQuery?: string;
  showSearch?: boolean;
  onCartOpen?: () => void;
  subnav?: ReactNode;
  announcement?: ReactNode;
  padded?: boolean;
  hero?: ReactNode;
  /** Studio nav needs real categories to map its free-text links. */
  categories?: StudioNavCategory[];
  onStudioNavigate?: (target: StudioLinkTarget, label: string) => void;
  studioNav?: StudioNavState;
}

const NO_CATEGORIES: StudioNavCategory[] = [];

function pinKey(subdomain: string) {
  return `khatario-store-pin:${subdomain}`;
}

export function StoreShell({
  children,
  onSearchChange,
  searchQuery = '',
  showSearch = false,
  onCartOpen,
  subnav,
  announcement,
  padded = true,
  hero,
  categories = NO_CATEGORIES,
  onStudioNavigate,
  studioNav,
}: StoreShellProps) {
  const { store, branches, selectedBranchId, selectBranch, cartCount, customer } = useStore();
  const pathname = usePathname();
  const hideCartBar = pathname === '/checkout' || pathname === '/cart' || pathname?.startsWith('/store/checkout') || pathname?.startsWith('/store/cart');
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [pincode, setPincode] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const theme = sanitizeStoreTheme(store?.store_theme);
  const studioSections = useStudioSections(theme, store, categories);

  useEffect(() => {
    if (!store) return;
    try {
      const saved = localStorage.getItem(pinKey(store.store_subdomain));
      if (saved) setPincode(saved);
    } catch {
      /* ignore */
    }
  }, [store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!store) return null;

  const selectedBranch = branches.find((b) => b.id === selectedBranchId);
  const showBranchPicker = branches.length > 1;
  const hideBadge = store.store_hide_khatario_badge;
  const khatario = isKhatarioPack(theme);
  const grocery = isGroceryPack(theme);
  const studio = !khatario && !grocery;
  const accent = theme.accent;
  const paper = storeCanvas(theme);
  const ink = chowkInkOn(paper);
  const onAccent = chowkOnAccent(accent);
  const logoUrl = theme.logo_url || store.logo_url;
  const searchPlaceholder =
    theme.search_placeholder || (khatario ? 'Search for items…' : 'Search for products, categories…');
  const pins = selectedBranch?.serviceable_pincodes ?? [];
  const pinOk =
    !pincode ||
    pins.length === 0 ||
    selectedBranch?.delivery_mode === 'all_india' ||
    pins.map((p) => p.replace(/\D/g, '')).includes(pincode);

  const persistPin = (value: string) => {
    const next = value.replace(/\D/g, '').slice(0, 6);
    setPincode(next);
    try {
      localStorage.setItem(pinKey(store.store_subdomain), next);
    } catch {
      /* ignore */
    }
  };

  const openCart = () => {
    if (onCartOpen) onCartOpen();
    else window.location.href = '/cart';
  };

  const locationLabel = selectedBranch?.name || store.name;
  const showPlace = Boolean(pincode) || locationLabel !== store.name;
  const hair = `color-mix(in srgb, ${ink} 12%, transparent)`;

  const branchPanel = branchPickerOpen ? (
    <div className="mt-2 border p-3" style={{ borderColor: hair, backgroundColor: paper }}>
      {showBranchPicker ? (
        <div className="mb-3 space-y-1">
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => selectBranch(b.id)}
              className={clsx('flex w-full items-center gap-2 px-3 py-2 text-left text-sm', b.id === selectedBranchId && 'font-medium')}
              style={b.id === selectedBranchId ? { color: accent } : undefined}
            >
              <MapPin className="h-3.5 w-3.5 opacity-50" />
              {b.name}
            </button>
          ))}
        </div>
      ) : null}
      <label className="block text-xs font-medium opacity-60">Pincode</label>
      <input
        inputMode="numeric"
        value={pincode}
        onChange={(e) => persistPin(e.target.value)}
        placeholder="6-digit pincode"
        className="mt-1 w-full border-0 border-b bg-transparent px-3 py-2 text-sm"
        style={{ borderColor: hair, color: ink }}
        maxLength={6}
      />
      {pincode.length === 6 && !pinOk ? (
        <p className="mt-2 text-xs text-amber-700">
          This store may not deliver to {pincode}. Pickup may still be available.
        </p>
      ) : pincode.length === 6 ? (
        <p className="mt-2 text-xs text-green-700">We can take orders for {pincode}.</p>
      ) : null}
      <button type="button" className="mt-2 text-xs opacity-60" onClick={() => setBranchPickerOpen(false)}>
        Done
      </button>
    </div>
  ) : null;

  const mobileNav = (
    <StoreMobileNav
      onSearch={() => {
        if (!showSearch) {
          window.location.href = '/';
          return;
        }
        searchRef.current?.focus();
      }}
      onCart={openCart}
    />
  );

  if (studio) {
    return (
      <div
        className={clsx('st-root min-h-screen', storePackClass(theme))}
        style={{
          ...studioThemeVars(theme),
          ...(theme.font_family !== 'system' ? { fontFamily: storeFontStack(theme.font_family) } : {}),
          backgroundColor: paper,
          ['--store-accent' as string]: accent,
          ['--store-paper' as string]: paper,
        }}
      >
        <StudioStoreHeader
          sections={studioSections}
          store={store}
          logoUrl={logoUrl}
          categories={categories}
          cartCount={cartCount}
          onCart={openCart}
          showSearch={showSearch}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          searchRef={searchRef}
          searchPlaceholder={searchPlaceholder}
          onNavigate={onStudioNavigate}
          navState={studioNav}
        />
        {showBranchPicker || pins.length > 0 ? (
          <div className="mx-auto max-w-6xl px-4 pt-2 text-xs">
            <button
              type="button"
              onClick={() => setBranchPickerOpen((o) => !o)}
              className="inline-flex items-center gap-1 opacity-70 hover:opacity-100"
            >
              <MapPin className="h-3.5 w-3.5" />
              {pincode ? `Deliver to ${pincode}` : showPlace ? locationLabel : 'Set delivery area'}
              <ChevronDown className="h-3 w-3" />
            </button>
            {branchPanel}
          </div>
        ) : null}
        <main
          className={clsx(
            hideCartBar ? 'pb-10' : 'pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pb-10',
            padded && 'mx-auto max-w-6xl px-4 pt-6',
          )}
        >
          {children}
        </main>
        {mobileNav}
        <StudioStoreFooter
          sections={studioSections}
          store={store}
          theme={theme}
          categories={categories}
          hideBadge={hideBadge}
        />
      </div>
    );
  }

  return (
    <div
      className={clsx('min-h-screen', storePackClass(theme))}
      style={{
        backgroundColor: paper,
        color: ink,
        ['--store-accent' as string]: accent,
        ['--store-paper' as string]: paper,
      }}
    >
      {grocery ? <GroceryMarquee theme={theme} fallback={store.store_tagline ?? ''} /> : announcement}

      <div className="sticky top-0 z-30" style={{ backgroundColor: khatario ? paper : undefined }}>
        {grocery ? (
          <GroceryHeader
            store={store}
            theme={theme}
            logoUrl={logoUrl}
            paper={paper}
            ink={ink}
            home={pathname === '/' || pathname === '/store'}
            showSearch={showSearch}
            searchQuery={searchQuery}
            searchPlaceholder={searchPlaceholder}
            searchRef={searchRef}
            onSearchChange={onSearchChange}
            cartCount={cartCount}
            onCart={openCart}
            customerInitial={customer?.name || customer?.phone ? (customer.name || customer.phone).slice(0, 1).toUpperCase() : null}
            onToggleArea={() => setBranchPickerOpen((o) => !o)}
            areaLabel={pincode ? `Deliver to ${pincode}` : locationLabel}
            branchPanel={branchPanel}
            subnav={subnav}
          />
        ) : (
          <header className="store-khatario-brand px-2.5 pb-3 pt-2 sm:px-3" style={{ backgroundColor: accent, color: onAccent }}>
            <div className="mx-auto max-w-lg space-y-2.5 sm:max-w-6xl">
              <div className="flex items-start justify-between gap-3">
                <Link href="/" className="flex min-w-0 items-center gap-2.5">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain p-1" />
                  ) : (
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
                      style={{ backgroundColor: onAccent, color: accent }}
                    >
                      {store.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-lg font-bold tracking-tight">{store.name}</span>
                    {showPlace || selectedBranch?.name ? (
                      <span className="block truncate text-xs opacity-80">
                        {selectedBranch?.name || locationLabel}
                      </span>
                    ) : store.store_tagline ? (
                      <span className="block truncate text-xs opacity-80">{store.store_tagline}</span>
                    ) : null}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setBranchPickerOpen((o) => !o)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold"
                >
                  <MapPin className="h-3.5 w-3.5" />
                  {pincode || 'Area'}
                  <ChevronDown className="h-3 w-3 opacity-80" />
                </button>
              </div>

              {showSearch ? (
                <div className="relative" role="search">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    id="store-search"
                    ref={searchRef}
                    type="search"
                    value={searchQuery}
                    onChange={(e) => onSearchChange?.(e.target.value)}
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    className="h-10 w-full rounded-xl border-0 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:outline-none"
                  />
                </div>
              ) : null}

              {branchPanel}
            </div>
            {hero ? (
              <div className="mx-auto mt-2.5 w-full max-w-lg sm:mt-3 sm:max-w-none sm:-mx-3 sm:w-[calc(100%+1.5rem)]">
                {hero}
              </div>
            ) : null}
          </header>
        )}
      </div>

      <main
        className={clsx(
          grocery
            ? 'pb-2'
            : hideCartBar
              ? 'pb-[calc(var(--chowk-nav)+var(--chowk-safe)+1rem)] sm:pb-10'
              : 'pb-[var(--chowk-chrome)]',
          padded && clsx('mx-auto px-4 pt-6', grocery ? 'max-w-7xl' : 'max-w-6xl'),
        )}
      >
        {children}
      </main>

      {mobileNav}

      {grocery ? (
        <GroceryFooter store={store} accent={accent} />
      ) : (
        <footer
          className="hidden border-t px-4 pt-12 md:block sm:px-0"
          style={{ borderColor: hair, paddingBottom: 'calc(2.5rem + var(--chowk-chrome))' }}
        >
          <div className="mx-auto grid max-w-6xl gap-8 sm:px-4 md:grid-cols-4">
            <div>
              <p className="text-[15px] font-semibold">{store.name}</p>
              {store.store_tagline ? (
                <p className="mt-2 text-[13px] leading-relaxed" style={{ opacity: 0.55 }}>
                  {store.store_tagline}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1 text-[13px]" style={{ opacity: 0.75 }}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ opacity: 0.5 }}>
                Quick links
              </p>
              <Link href="/about">About</Link>
              <Link href="/contact">Contact</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/refund">Refunds</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/wishlist">Wishlist</Link>
              <Link href="/account">Your orders</Link>
            </div>
            <div className="text-[13px]" style={{ opacity: 0.75 }}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ opacity: 0.5 }}>
                Contact
              </p>
              {store.phone ? <a href={`tel:${store.phone}`}>{store.phone}</a> : null}
            </div>
            <p className="text-[11px] md:text-right" style={{ opacity: 0.4 }}>
              {hideBadge ? store.name : 'Powered by Khatario'}
            </p>
          </div>
        </footer>
      )}
    </div>
  );
}
