'use client';

import { Phone, ShoppingCart, Search, MapPin, ChevronDown, User } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { StoreMobileNav } from './StoreMobileNav';
import { sanitizeStoreTheme } from '@/lib/store/store-theme';

interface StoreShellProps {
  children: React.ReactNode;
  onSearchChange?: (query: string) => void;
  searchQuery?: string;
  showSearch?: boolean;
  onCartOpen?: () => void;
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

  if (!store) return null;

  const selectedBranch = branches.find((b) => b.id === selectedBranchId);
  const showBranchPicker = branches.length > 1;
  const hideBadge = store.store_hide_khatario_badge;
  const theme = sanitizeStoreTheme(store.store_theme);
  const accent = theme.accent;
  const logoUrl = theme.logo_url || store.logo_url;
  const searchPlaceholder = theme.search_placeholder || 'Search products...';
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

  return (
    <div className="min-h-screen" style={{ backgroundColor: theme.background }}>
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
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

          {branchPickerOpen ? (
            <div className="mt-2 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
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
                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm',
                        b.id === selectedBranchId ? 'bg-gray-50 font-medium' : 'hover:bg-gray-50',
                      )}
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
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
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
          ) : null}

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

      <main className="mx-auto max-w-6xl px-4 pb-36 pt-4 sm:pb-24">{children}</main>

      {cartCount > 0 && !hideCartBar ? (
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
          document.getElementById('store-search')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
        onCart={openCart}
      />

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
    </div>
  );
}
