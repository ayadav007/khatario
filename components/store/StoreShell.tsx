'use client';

import { Phone, ShoppingCart, Search, MapPin, ChevronDown, User } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { StoreMobileNav } from './StoreMobileNav';
import { chowkInkOn, isChowkPack, sanitizeStoreTheme } from '@/lib/store/store-theme';

interface StoreShellProps {
  children: React.ReactNode;
  onSearchChange?: (query: string) => void;
  searchQuery?: string;
  showSearch?: boolean;
  onCartOpen?: () => void;
  subnav?: ReactNode;
  announcement?: ReactNode;
  padded?: boolean;
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
  const accent = theme.accent;
  const paper = theme.background;
  const ink = chowkInkOn(paper);
  const logoUrl = theme.logo_url || store.logo_url;
  const searchPlaceholder = theme.search_placeholder || (chowk ? 'Search the shop' : 'Search products...');
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
      className={clsx('mt-2 p-3', chowk ? 'border' : 'rounded-xl border border-gray-200 bg-white shadow-lg')}
      style={chowk ? { borderColor: hair, backgroundColor: paper } : undefined}
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
                !chowk && 'rounded-lg',
                b.id === selectedBranchId ? (chowk ? 'font-medium' : 'bg-gray-50 font-medium') : chowk ? '' : 'hover:bg-gray-50',
              )}
              style={chowk && b.id === selectedBranchId ? { color: accent } : undefined}
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
        className={clsx('mt-1 w-full px-3 py-2 text-sm', chowk ? 'border-0 border-b bg-transparent' : 'rounded-lg border border-gray-200')}
        style={chowk ? { borderColor: hair, color: ink } : undefined}
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
      className={clsx('min-h-screen', chowk && 'store-chowk font-chowk')}
      style={{ backgroundColor: paper, color: chowk ? ink : undefined }}
    >
      {announcement}

      <div className="sticky top-0 z-30" style={chowk ? { borderBottom: `1px solid ${hair}`, backgroundColor: paper } : undefined}>
        {chowk ? (
          <header style={{ backgroundColor: paper }}>
            <div className="mx-auto max-w-6xl px-4">
              <div className="flex items-start gap-3 pt-3">
                <div className="flex min-w-0 flex-1 gap-2.5">
                  <Link href="/" className="flex-shrink-0 pt-0.5">
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logoUrl}
                        alt=""
                        className="h-8 w-auto max-h-8 max-w-[6.75rem] object-contain object-left sm:h-9 sm:max-h-9 sm:max-w-[8.5rem]"
                      />
                    ) : (
                      <span className="font-chowk-display block w-7 text-[1.35rem] leading-none sm:text-[1.5rem]">
                        {store.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </Link>
                  <div className="min-w-0">
                    <Link
                      href="/"
                      className="font-chowk-display block text-[1.05rem] leading-[1.08] tracking-tight sm:text-[1.28rem]"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {store.name}
                    </Link>
                    {showPlace ? (
                    <button
                      type="button"
                      onClick={() => setBranchPickerOpen((o) => !o)}
                      className="mt-1.5 max-w-full truncate text-left text-[11px] leading-none"
                      style={{ opacity: 0.48 }}
                    >
                      {pincode || locationLabel}
                      <ChevronDown className="ml-0.5 inline h-2.5 w-2.5" />
                    </button>
                    ) : (
                    <button
                      type="button"
                      onClick={() => setBranchPickerOpen((o) => !o)}
                      className="mt-1.5 text-left text-[11px] leading-none"
                      style={{ opacity: 0.4 }}
                      aria-label="Set pincode"
                    >
                      Area
                      <ChevronDown className="ml-0.5 inline h-2.5 w-2.5" />
                    </button>
                    )}
                  </div>
                </div>

                <Link href="/account" className="hidden pt-1 text-[12px] sm:inline" style={{ color: ink, opacity: 0.7 }}>
                  Account
                </Link>
                <button type="button" onClick={openCart} className="shrink-0 pt-1 text-[12px]" aria-label={cartCount > 0 ? `Bag, ${cartCount} items` : 'Bag'}>
                  Bag
                  {cartCount > 0 ? (
                    <span className="tabular-nums" style={{ color: accent }}>
                      {' · '}
                      {cartCount}
                    </span>
                  ) : null}
                </button>
              </div>

              {showSearch ? (
                <div className="relative pb-2 pt-3" role="search">
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
                    className="w-full border-0 border-b bg-transparent py-2 pr-8 text-[15px] outline-none"
                    style={{ borderColor: hair, color: ink }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = accent;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = hair;
                    }}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      className="absolute right-0 top-1/2 min-h-11 min-w-11 -translate-y-1/2 text-[12px]"
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
          <header className="border-b border-gray-200 bg-white shadow-sm">
            <div className="mx-auto max-w-6xl px-4 py-2.5">
              <div className="flex items-center gap-3">
                <Link href="/" className="flex min-w-0 items-center gap-2 sm:gap-3">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="" className="h-9 w-9 flex-shrink-0 rounded-lg object-contain sm:h-10 sm:w-10" />
                  ) : (
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-sm font-bold text-gray-700 sm:h-10 sm:w-10">
                      {store.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900 sm:text-base">{store.name}</p>
                    {store.store_tagline ? (
                      <p className="hidden truncate text-xs text-gray-500 md:block">{store.store_tagline}</p>
                    ) : null}
                  </div>
                </Link>

                <button
                  type="button"
                  onClick={() => setBranchPickerOpen((o) => !o)}
                  className="ml-auto flex min-w-0 max-w-[42%] items-center gap-1 rounded-lg px-2 py-1.5 text-left hover:bg-gray-50 sm:ml-0 sm:max-w-xs sm:flex-1"
                >
                  <MapPin className="h-4 w-4 flex-shrink-0" style={{ color: accent }} />
                  <span className="min-w-0">
                    <span className="block text-[10px] uppercase tracking-wide text-gray-400">Deliver to</span>
                    <span className="flex items-center gap-1 truncate text-xs font-medium text-gray-800">
                      {pincode || locationLabel}
                      <ChevronDown className="h-3 w-3 text-gray-400" />
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
                      className="w-full rounded-full border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300"
                    />
                  </div>
                ) : null}

                <nav className="hidden items-center gap-1 text-sm text-gray-600 lg:flex">
                  <Link href="/" className="rounded-lg px-2 py-1 hover:bg-gray-50">Home</Link>
                  <a href="#categories" className="rounded-lg px-2 py-1 hover:bg-gray-50">Categories</a>
                  <Link href="/contact" className="rounded-lg px-2 py-1 hover:bg-gray-50">Contact</Link>
                </nav>

                <Link href="/account" className="hidden h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 sm:flex" aria-label="Account">
                  {customer?.name || customer?.phone ? (
                    <span className="text-xs font-semibold" style={{ color: accent }}>
                      {(customer.name || customer.phone).slice(0, 1).toUpperCase()}
                    </span>
                  ) : (
                    <User className="h-4 w-4" />
                  )}
                </Link>
                {store.phone ? (
                  <a href={`tel:${store.phone}`} className="hidden h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 sm:flex" aria-label="Call store">
                    <Phone className="h-4 w-4" />
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={openCart}
                  className="relative flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100"
                  aria-label="Cart"
                >
                  <ShoppingCart className="h-4 w-4" />
                  {cartCount > 0 ? (
                    <span
                      className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                      style={{ backgroundColor: accent }}
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
                    className="w-full rounded-full border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
                  />
                </div>
              ) : null}
            </div>
          </header>
        )}
      </div>

      <main
        className={clsx(
          chowk
            ? hideCartBar
              ? 'pb-[calc(var(--chowk-nav)+var(--chowk-safe)+1rem)] sm:pb-10'
              : 'pb-[var(--chowk-chrome)]'
            : 'mx-auto max-w-6xl px-4 pb-36 pt-4 sm:pb-24',
          chowk && padded && 'mx-auto max-w-6xl px-4 pt-6',
        )}
      >
        {children}
      </main>

      {chowk && !hideCartBar ? (
        <div className={clsx('chowk-bag-dock fixed left-0 right-0 z-30', cartCount > 0 ? 'pointer-events-auto' : 'pointer-events-none')}>
          <button
            type="button"
            onClick={openCart}
            className={clsx('chowk-bag-strip flex w-full items-center justify-between px-4 py-3 text-[13px]', cartCount > 0 && 'is-on')}
            style={{
              backgroundColor: paper,
              color: ink,
              borderTop: `1px solid ${hair}`,
            }}
            aria-hidden={cartCount === 0}
            tabIndex={cartCount > 0 ? 0 : -1}
            aria-label={cartCount > 0 ? `Open bag, ${cartCount} items, ₹${cartTotal.toLocaleString('en-IN')}` : 'Bag'}
          >
            <span>
              Bag · {cartCount}
            </span>
            <span className="tabular-nums">
              ₹{cartTotal.toLocaleString('en-IN')}
              <span className="ml-2" style={{ color: accent }}>
                View
              </span>
            </span>
          </button>
        </div>
      ) : cartCount > 0 && !hideCartBar ? (
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

      {chowk ? (
        <footer
          className="border-t px-4 pt-12 sm:px-0"
          style={{ borderColor: hair, paddingBottom: 'calc(2.5rem + var(--chowk-chrome))' }}
        >
          <div className="mx-auto max-w-6xl sm:px-4">
            <p className="font-chowk-display line-clamp-3 break-words text-[clamp(1.65rem,8vw,2.75rem)] leading-[0.95]">{store.name}</p>
            {store.store_tagline ? (
              <p className="mt-2 line-clamp-3 max-w-md text-[13px] leading-relaxed" style={{ opacity: 0.55 }}>
                {store.store_tagline}
              </p>
            ) : null}
            <div className="mt-6 flex flex-col gap-1 text-[13px]" style={{ opacity: 0.7 }}>
              {store.phone ? <a href={`tel:${store.phone}`}>{store.phone}</a> : null}
              <Link href="/about">About</Link>
              <Link href="/contact">Contact</Link>
              <Link href="/account">Your orders</Link>
            </div>
            <p className="mt-8 text-[11px]" style={{ opacity: 0.4 }}>
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
