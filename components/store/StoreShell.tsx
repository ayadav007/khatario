'use client';

import { Phone, ShoppingCart, Search, MapPin, ChevronDown, User } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { useState } from 'react';
import clsx from 'clsx';
import Link from 'next/link';

interface StoreShellProps {
  children: React.ReactNode;
  onSearchChange?: (query: string) => void;
  searchQuery?: string;
  showSearch?: boolean;
  onCartOpen?: () => void;
}

export function StoreShell({
  children,
  onSearchChange,
  searchQuery = '',
  showSearch = false,
  onCartOpen,
}: StoreShellProps) {
  const { store, branches, selectedBranchId, selectBranch, cartCount, cartTotal } = useStore();
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);

  if (!store) return null;

  const selectedBranch = branches.find((b) => b.id === selectedBranchId);
  const showBranchPicker = branches.length > 1;
  const hideBadge = store.store_hide_khatario_badge;
  const accent = (store.store_theme?.accent as string) || '#16a34a';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex min-w-0 flex-1 items-center gap-3">
              {store.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={store.logo_url}
                  alt=""
                  className="h-10 w-10 flex-shrink-0 rounded-lg object-contain"
                />
              ) : (
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-sm font-bold text-gray-700">
                  {store.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold text-gray-900">
                  {store.name}
                </h1>
                {store.store_tagline ? (
                  <p className="truncate text-xs text-gray-500">{store.store_tagline}</p>
                ) : null}
              </div>
            </Link>
            <nav className="hidden items-center gap-4 text-sm text-gray-600 sm:flex">
              <Link href="/about" className="hover:text-gray-900">About</Link>
              <Link href="/contact" className="hover:text-gray-900">Contact</Link>
              <Link href="/account" className="hover:text-gray-900">
                <User className="h-4 w-4" />
              </Link>
            </nav>
            {store.phone ? (
              <a
                href={`tel:${store.phone}`}
                className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
                aria-label="Call store"
              >
                <Phone className="h-4 w-4" />
              </a>
            ) : null}
            <Link
              href="/cart"
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
            </Link>
          </div>

          {showBranchPicker ? (
            <div className="relative mt-2">
              <button
                onClick={() => setBranchPickerOpen(!branchPickerOpen)}
                className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm"
              >
                <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                <span className="flex-1 truncate text-gray-700">
                  {selectedBranch ? selectedBranch.name : 'Select location'}
                </span>
                <ChevronDown
                  className={clsx(
                    'h-3.5 w-3.5 text-gray-400 transition-transform',
                    branchPickerOpen && 'rotate-180',
                  )}
                />
              </button>
              {branchPickerOpen ? (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {branches.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => {
                        selectBranch(b.id);
                        setBranchPickerOpen(false);
                      }}
                      className={clsx(
                        'flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm',
                        b.id === selectedBranchId
                          ? 'bg-gray-50 font-medium text-gray-900'
                          : 'text-gray-700 hover:bg-gray-50',
                      )}
                    >
                      <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                      <span className="flex-1 truncate">{b.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {showSearch ? (
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange?.(e.target.value)}
                placeholder="Search products..."
                className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300"
              />
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-4">{children}</main>

      {cartCount > 0 && onCartOpen ? (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-200 bg-white pb-[max(8px,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-6xl px-4 py-3">
            <button
              onClick={onCartOpen}
              className="flex w-full items-center justify-between rounded-xl px-5 py-3.5 text-white shadow-lg"
              style={{ backgroundColor: accent }}
            >
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                <span className="text-sm font-semibold">
                  {cartCount} {cartCount === 1 ? 'item' : 'items'}
                </span>
              </div>
              <span className="text-base font-bold">
                View Cart &middot; &#x20B9;{cartTotal.toLocaleString('en-IN')}
              </span>
            </button>
          </div>
        </div>
      ) : null}

      <footer className="border-t border-gray-200 py-6 text-center text-xs text-gray-400">
        <div className="mb-2 flex justify-center gap-4 sm:hidden">
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/account">Account</Link>
        </div>
        {hideBadge ? store.name : 'Powered by Khatario'}
      </footer>
    </div>
  );
}
