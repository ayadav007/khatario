'use client';

import { Phone, ShoppingCart, Search, MapPin, ChevronDown, User, Heart } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { StoreMobileNav } from './StoreMobileNav';
import { chowkInkOn, chowkOnAccent, isAtelierPack, isChowkPack, isKhatarioPack, isNoirPack, isPackChrome, sanitizeStoreTheme, storeCanvas } from '@/lib/store/store-theme';

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
}

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
}: StoreShellProps) {
  const { store, branches, selectedBranchId, selectBranch, cartCount, cartTotal, customer } = useStore();
  const pathname = usePathname();
  const hideCartBar = pathname === '/checkout' || pathname === '/cart' || pathname?.startsWith('/store/checkout') || pathname?.startsWith('/store/cart');
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [pincode, setPincode] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

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
  const theme = sanitizeStoreTheme(store.store_theme);
  const chowk = isChowkPack(theme);
  const atelier = isAtelierPack(theme);
  const khatario = isKhatarioPack(theme);
  const noir = isNoirPack(theme);
  const pack = isPackChrome(theme);
  const accent = theme.accent;
  const paper = storeCanvas(theme);
  const ink = chowkInkOn(paper);
  const onAccent = chowkOnAccent(accent);
  const logoUrl = theme.logo_url || store.logo_url;
  const searchPlaceholder =
    theme.search_placeholder ||
    (atelier
      ? 'Search jackets, cashmere, accessories…'
      : khatario
        ? 'Search for items…'
        : chowk
        ? 'Search for rice, oil, milk…'
        : 'Search products...');
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
  const showPlace = Boolean(pincode) || (locationLabel !== store.name);
  const hair = `color-mix(in srgb, ${ink} 12%, transparent)`;

  const branchPanel = branchPickerOpen ? (
    <div
      className={clsx('mt-2 p-3', pack ? 'border' : 'rounded-xl border border-gray-200 bg-white shadow-lg')}
      style={pack ? { borderColor: hair, backgroundColor: paper } : undefined}
    >
      {showBranchPicker ? (
        <div className="mb-3 space-y-1">
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                selectBranch(b.id);
              }}
              className={clsx(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                !pack && 'rounded-lg',
                b.id === selectedBranchId ? (pack ? 'font-medium' : 'bg-gray-50 font-medium') : pack ? '' : 'hover:bg-gray-50',
              )}
              style={pack && b.id === selectedBranchId ? { color: accent } : undefined}
            >
              <MapPin className="h-3.5 w-3.5 text-gray-400" />
              {b.name}
            </button>
          ))}
        </div>
      ) : null}
      <label className="block text-xs font-medium text-gray-500">Pincode</label>
      <input
        inputMode="numeric"
        value={pincode}
        onChange={(e) => persistPin(e.target.value)}
        placeholder="6-digit pincode"
        className={clsx('mt-1 w-full px-3 py-2 text-sm', pack ? 'border-0 border-b bg-transparent' : 'rounded-lg border border-gray-200')}
        style={pack ? { borderColor: hair, color: ink } : undefined}
        maxLength={6}
      />
      {pincode.length === 6 && !pinOk ? (
        <p className="mt-2 text-xs text-amber-700">
          This store may not deliver to {pincode}. Pickup may still be available.
        </p>
      ) : pincode.length === 6 ? (
        <p className="mt-2 text-xs text-green-700">We can take orders for {pincode}.</p>
      ) : null}
      <button type="button" className="mt-2 text-xs text-gray-500" onClick={() => setBranchPickerOpen(false)}>
        Done
      </button>
    </div>
  ) : null;

  return (
    <div
      className={clsx(
        'min-h-screen',
        chowk && 'store-chowk font-chowk',
        atelier && 'store-atelier font-atelier',
        khatario && 'store-khatario',
        noir && 'store-noir',
      )}
      style={{
        backgroundColor: paper,
        color: pack ? ink : undefined,
        ['--store-accent' as string]: accent,
      }}
    >
      {announcement}

      <div
        className="sticky top-0 z-30"
        style={
          khatario
            ? { backgroundColor: paper }
            : pack
              ? { borderBottom: `1px solid ${hair}`, backgroundColor: paper }
              : { backgroundColor: accent }
        }
      >
        {noir ? (
          <header className="store-noir" style={{ backgroundColor: paper, color: ink }}>
            {theme.announcement ? (
              <p className="truncate px-4 py-1.5 text-center text-[11px] tracking-wide" style={{ backgroundColor: ink, color: paper }}>
                {theme.announcement}
              </p>
            ) : null}
            <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
              <Link href="/" className="flex min-w-0 items-center gap-2">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="h-8 w-auto max-w-[7rem] object-contain" />
                ) : (
                  <span className="font-noir-display text-lg tracking-[0.2em]">{store.name.slice(0, 18)}</span>
                )}
                {theme.show_store_name && logoUrl ? <span className="truncate text-sm tracking-wide">{store.name}</span> : null}
              </Link>
              <nav className="hidden min-w-0 flex-1 items-center gap-5 text-[12px] uppercase tracking-[0.14em] md:flex">
                <Link href="/">Home</Link>
                <Link href="/">Shop</Link>
                <Link href="/about">About</Link>
                <Link href="/wishlist">Wishlist</Link>
              </nav>
              <div className="ml-auto flex items-center gap-1">
                <Link href="/wishlist" className="flex h-9 w-9 items-center justify-center" aria-label="Wishlist">
                  <Heart className="h-4 w-4" strokeWidth={1.5} />
                </Link>
                <Link href="/account" className="flex h-9 w-9 items-center justify-center" aria-label="Account">
                  <User className="h-4 w-4" strokeWidth={1.5} />
                </Link>
                <button type="button" onClick={openCart} className="relative flex h-9 w-9 items-center justify-center" aria-label="Bag">
                  <ShoppingCart className="h-4 w-4" strokeWidth={1.5} />
                  {cartCount > 0 ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} /> : null}
                </button>
              </div>
            </div>
            {showSearch ? (
              <div className="mx-auto max-w-6xl px-4 pb-3">
                <input
                  ref={searchRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => onSearchChange?.(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-10 w-full border bg-transparent px-3 text-sm"
                  style={{ borderColor: `${ink}33` }}
                />
              </div>
            ) : null}
          </header>
        ) : khatario ? (
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
        ) : atelier ? (
          <header style={{ backgroundColor: paper }}>
            <div className="mx-auto max-w-6xl px-4">
              <div className="flex items-center gap-3 py-3">
                <Link href="/" className="min-w-0">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="" className="h-8 w-auto max-w-[8rem] object-contain object-left" />
                  ) : (
                    <span className="font-atelier-display block truncate text-[1.15rem] tracking-[0.18em]">
                      {store.name}
                    </span>
                  )}
                </Link>
                <div className="ml-auto flex items-center gap-1">
                  <Link
                    href="/account"
                    className="hidden h-9 w-9 items-center justify-center rounded-full sm:flex"
                    aria-label="Account"
                    style={{ backgroundColor: `color-mix(in srgb, ${ink} 6%, ${paper})` }}
                  >
                    {customer?.name || customer?.phone ? (
                      <span className="text-[11px] font-medium">
                        {(customer.name || customer.phone).slice(0, 1).toUpperCase()}
                      </span>
                    ) : (
                      <User className="h-4 w-4" strokeWidth={1.5} />
                    )}
                  </Link>
                  <button
                    type="button"
                    onClick={openCart}
                    className="relative flex h-9 w-9 items-center justify-center"
                    aria-label={cartCount > 0 ? `Bag, ${cartCount} items` : 'Bag'}
                  >
                    <ShoppingCart className="h-4 w-4" strokeWidth={1.5} />
                    {cartCount > 0 ? (
                      <span
                        className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: accent }}
                      />
                    ) : null}
                  </button>
                </div>
              </div>
              {showSearch ? (
                <div className="relative pb-3" role="search">
                  <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ opacity: 0.35 }} />
                  <input
                    id="store-search"
                    ref={searchRef}
                    type="search"
                    value={searchQuery}
                    onChange={(e) => onSearchChange?.(e.target.value)}
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    className="w-full rounded-full border-0 py-2.5 pl-10 pr-4 text-[13px] outline-none"
                    style={{
                      color: ink,
                      backgroundColor: `color-mix(in srgb, ${ink} 5%, ${paper})`,
                    }}
                  />
                </div>
              ) : null}
              {branchPanel}
            </div>
            {subnav ? <div className="mx-auto max-w-6xl px-4">{subnav}</div> : null}
          </header>
        ) : chowk ? (
          <header className="bg-white/80 backdrop-blur-sm" style={{ backgroundColor: paper }}>
            <div className="mx-auto max-w-6xl px-4">
              <div className="hidden items-center justify-between py-1.5 text-[11px] md:flex" style={{ color: ink, opacity: 0.55 }}>
                <span className="truncate">{store.store_tagline || 'Fresh groceries from your local store'}</span>
                <button type="button" onClick={() => setBranchPickerOpen((o) => !o)} className="shrink-0">
                  {pincode ? `Deliver to ${pincode}` : showPlace ? locationLabel : 'Set delivery area'}
                  <ChevronDown className="ml-0.5 inline h-3 w-3" />
                </button>
              </div>
              <div className="flex items-center gap-3 py-2.5">
                <Link href="/" className="flex min-w-0 items-center gap-2.5">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl}
                      alt=""
                      className="h-9 w-9 rounded-full object-cover sm:h-10 sm:w-10"
                    />
                  ) : (
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold sm:h-10 sm:w-10"
                      style={{ backgroundColor: accent, color: '#fff7ed' }}
                    >
                      {store.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold leading-tight sm:text-base">{store.name}</span>
                    {store.store_tagline ? (
                      <span className="hidden truncate text-[11px] md:block" style={{ opacity: 0.5 }}>
                        {store.store_tagline}
                      </span>
                    ) : null}
                  </span>
                </Link>

                {showSearch ? (
                  <div className="relative hidden min-w-0 flex-1 md:block" role="search">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ opacity: 0.35 }} />
                    <input
                      ref={searchRef}
                      type="search"
                      value={searchQuery}
                      onChange={(e) => onSearchChange?.(e.target.value)}
                      placeholder={searchPlaceholder}
                      aria-label={searchPlaceholder}
                      className="w-full rounded-full border-0 bg-white py-2.5 pl-10 pr-4 text-sm outline-none shadow-sm"
                      style={{ color: ink }}
                    />
                  </div>
                ) : null}

                <Link href="/account" className="hidden text-[13px] font-medium sm:inline" style={{ color: ink, opacity: 0.75 }}>
                  Account
                </Link>
                <button
                  type="button"
                  onClick={openCart}
                  className="relative shrink-0 rounded-full bg-white px-3 py-1.5 text-[13px] font-medium shadow-sm"
                  aria-label={cartCount > 0 ? `Bag, ${cartCount} items` : 'Bag'}
                >
                  Bag
                  {cartCount > 0 ? (
                    <span className="ml-1 tabular-nums" style={{ color: accent }}>
                      {cartCount}
                    </span>
                  ) : null}
                </button>
              </div>

              {showSearch ? (
                <div className="relative pb-2 md:hidden" role="search">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ opacity: 0.35 }} />
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
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    enterKeyHint="search"
                    autoComplete="off"
                    className="w-full rounded-full border-0 bg-white py-2.5 pl-10 pr-10 text-[15px] outline-none shadow-sm"
                    style={{ color: ink }}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      className="absolute right-1 top-1/2 min-h-11 min-w-11 -translate-y-1/2 text-[12px]"
                      style={{ color: ink, opacity: 0.45 }}
                      aria-label="Clear search"
                      onClick={() => {
                        onSearchChange?.('');
                        searchRef.current?.focus();
                      }}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              ) : null}

              {branchPanel}
            </div>
            {subnav ? <div className="mx-auto max-w-6xl px-4">{subnav}</div> : null}
          </header>
        ) : (
          <header className="relative z-30" style={{ backgroundColor: accent, color: onAccent }}>
            <div className="mx-auto max-w-6xl px-4 py-2.5">
              <div className="flex items-center gap-3">
                <Link href="/" className="flex min-w-0 items-center gap-2 sm:gap-3">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="" className="h-9 w-9 flex-shrink-0 rounded-lg bg-white object-contain p-0.5 sm:h-10 sm:w-10" />
                  ) : (
                    <div
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold sm:h-10 sm:w-10"
                      style={{ backgroundColor: onAccent, color: accent }}
                    >
                      {store.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold sm:text-base">{store.name}</p>
                    {store.store_tagline ? (
                      <p className="hidden truncate text-xs opacity-80 md:block">{store.store_tagline}</p>
                    ) : null}
                  </div>
                </Link>

                <button
                  type="button"
                  onClick={() => setBranchPickerOpen((o) => !o)}
                  className="ml-auto flex min-w-0 max-w-[42%] items-center gap-1 rounded-full bg-white px-2.5 py-1.5 text-left sm:ml-0 sm:max-w-xs sm:flex-1"
                  style={{ color: accent }}
                >
                  <MapPin className="h-4 w-4 flex-shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-[10px] uppercase tracking-wide opacity-70">Deliver to</span>
                    <span className="flex items-center gap-1 truncate text-xs font-medium">
                      {pincode || locationLabel}
                      <ChevronDown className="h-3 w-3 opacity-70" />
                    </span>
                  </span>
                </button>

                {showSearch ? (
                  <div className="relative hidden min-w-0 flex-1 md:block">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      id="store-search-desktop"
                      type="search"
                      value={searchQuery}
                      onChange={(e) => onSearchChange?.(e.target.value)}
                      placeholder={searchPlaceholder}
                      className="w-full rounded-full border-0 bg-white py-2.5 pl-9 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
                    />
                  </div>
                ) : null}

                <nav className="hidden items-center gap-1 text-sm lg:flex">
                  <Link href="/" className="rounded-lg px-2 py-1 opacity-90 hover:opacity-100">Home</Link>
                  <a href="#categories" className="rounded-lg px-2 py-1 opacity-90 hover:opacity-100">Categories</a>
                  <Link href="/contact" className="rounded-lg px-2 py-1 opacity-90 hover:opacity-100">Contact</Link>
                </nav>

                <Link href="/account" className="hidden h-9 w-9 items-center justify-center rounded-full bg-white/15 sm:flex" aria-label="Account">
                  {customer?.name || customer?.phone ? (
                    <span className="text-xs font-semibold">
                      {(customer.name || customer.phone).slice(0, 1).toUpperCase()}
                    </span>
                  ) : (
                    <User className="h-4 w-4" />
                  )}
                </Link>
                {store.phone ? (
                  <a href={`tel:${store.phone}`} className="hidden h-9 w-9 items-center justify-center rounded-full bg-white/15 sm:flex" aria-label="Call store">
                    <Phone className="h-4 w-4" />
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={openCart}
                  className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/15"
                  aria-label="Cart"
                >
                  <ShoppingCart className="h-4 w-4" />
                  {cartCount > 0 ? (
                    <span
                      className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                      style={{ backgroundColor: onAccent, color: accent }}
                    >
                      {cartCount}
                    </span>
                  ) : null}
                </button>
              </div>

              {branchPanel}

              {showSearch ? (
                <div className="relative mt-2 md:hidden">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    id="store-search"
                    ref={searchRef}
                    type="search"
                    value={searchQuery}
                    onChange={(e) => onSearchChange?.(e.target.value)}
                    placeholder={searchPlaceholder}
                    className="w-full rounded-full border-0 bg-white py-2.5 pl-9 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
                  />
                </div>
              ) : null}
            </div>
          </header>
        )}
      </div>

      <main
        className={clsx(
          pack
            ? hideCartBar
              ? 'pb-[calc(var(--chowk-nav)+var(--chowk-safe)+1rem)] sm:pb-10'
              : 'pb-[var(--chowk-chrome)]'
            : 'mx-auto max-w-6xl px-4 pb-36 pt-0 sm:pb-24',
          pack && padded && 'mx-auto max-w-6xl px-4 pt-6',
        )}
      >
        {children}
      </main>

      {pack && !hideCartBar ? null : cartCount > 0 && !hideCartBar ? (
        <div className="fixed bottom-14 left-0 right-0 z-30 px-3 sm:bottom-4 sm:px-4">
          <div className="mx-auto max-w-6xl">
            <button
              type="button"
              onClick={openCart}
              className="flex w-full items-center justify-between rounded-2xl px-5 py-3 text-white shadow-lg"
              style={{ backgroundColor: accent }}
            >
              <span className="text-sm font-semibold">
                {cartCount} {cartCount === 1 ? 'item' : 'items'}
              </span>
              <span className="text-sm font-bold">
                ₹{cartTotal.toLocaleString('en-IN')} · View cart
              </span>
            </button>
          </div>
        </div>
      ) : null}

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

      {pack ? (
        <footer
          className="hidden border-t px-4 pt-12 md:block sm:px-0"
          style={{ borderColor: hair, paddingBottom: 'calc(2.5rem + var(--chowk-chrome))' }}
        >
          <div className="mx-auto grid max-w-6xl gap-8 sm:px-4 md:grid-cols-4">
            <div>
              <p className={atelier ? 'font-atelier-display text-[1.05rem] tracking-[0.12em]' : 'text-[15px] font-semibold'}>{store.name}</p>
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
      ) : (
        <>
          <footer className="hidden border-t border-gray-200 bg-white py-8 sm:block">
            <div className="mx-auto grid max-w-6xl gap-6 px-4 text-sm text-gray-600 md:grid-cols-3">
              <div>
                <p className="font-semibold text-gray-900">{store.name}</p>
                {store.store_tagline ? <p className="mt-1 text-xs text-gray-500">{store.store_tagline}</p> : null}
                {store.phone ? <p className="mt-2 text-xs">{store.phone}</p> : null}
              </div>
              <div className="flex flex-col gap-1">
                <Link href="/about" className="hover:text-gray-900">About</Link>
                <Link href="/contact" className="hover:text-gray-900">Contact</Link>
                <Link href="/privacy" className="hover:text-gray-900">Privacy</Link>
                <Link href="/refund" className="hover:text-gray-900">Refunds</Link>
                <Link href="/terms" className="hover:text-gray-900">Terms</Link>
                <Link href="/wishlist" className="hover:text-gray-900">Wishlist</Link>
                <Link href="/account" className="hover:text-gray-900">Your orders</Link>
              </div>
              <div className="text-xs text-gray-400">
                <p>Delivery and pickup as set by the store.</p>
                <p className="mt-2">{hideBadge ? store.name : 'Powered by Khatario'}</p>
              </div>
            </div>
          </footer>
          <p className="py-3 text-center text-[10px] text-gray-400 sm:hidden">
            {hideBadge ? store.name : 'Powered by Khatario'}
          </p>
        </>
      )}
    </div>
  );
}
