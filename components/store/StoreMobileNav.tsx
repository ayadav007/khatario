'use client';

import { Home, Search, LayoutGrid, Tag, User, ShoppingBag, ShoppingCart, ClipboardList, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useStore } from '@/lib/store/store-context';
import { chowkInkOn, chowkOnAccent, sanitizeStoreTheme, storeCanvas } from '@/lib/store/store-theme';

export function StoreMobileNav({
  onSearch,
  onCart,
}: {
  onSearch?: () => void;
  onCart?: () => void;
}) {
  const pathname = usePathname();
  const { cartCount, store } = useStore();
  const theme = sanitizeStoreTheme(store?.store_theme);
  const accent = theme.accent;
  const chowk = theme.pack === 'chowk';
  const atelier = theme.pack === 'atelier';
  const khatario = theme.pack === 'khatario';
  const pack = chowk || atelier || khatario;
  const ink = chowkInkOn(storeCanvas(theme));
  const hair = `color-mix(in srgb, ${ink} 12%, transparent)`;

  const item = (active: boolean) =>
    clsx(
      'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium',
      active ? '' : pack ? 'opacity-40' : 'text-gray-400',
    );

  if (khatario) {
    return (
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-black/5 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-4 gap-1 px-2 pt-2">
          <Link
            href="/"
            className={item(pathname === '/' || pathname === '/store')}
            style={pathname === '/' || pathname === '/store' ? { color: accent, opacity: 1 } : undefined}
          >
            <Home className="h-5 w-5" />
            Home
          </Link>
          <button type="button" onClick={onCart} className={item(pathname === '/cart')} style={pathname === '/cart' ? { color: accent, opacity: 1 } : undefined}>
            <span className="relative">
              <ShoppingBag className="h-5 w-5" />
              {cartCount > 0 ? (
                <span
                  className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-bold text-white"
                  style={{ backgroundColor: accent }}
                >
                  {cartCount}
                </span>
              ) : null}
            </span>
            Cart
          </button>
          <Link href="/account" className={item(pathname === '/account')} style={pathname === '/account' ? { color: accent, opacity: 1 } : undefined}>
            <ClipboardList className="h-5 w-5" />
            Orders
          </Link>
          <Link href="/account" className={item(false)}>
            <MoreHorizontal className="h-5 w-5" />
            More
          </Link>
        </div>
      </nav>
    );
  }

  if (atelier) {
    return (
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 border-t bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:hidden"
        style={{ borderColor: hair, color: ink }}
      >
        <div className="flex">
          <Link href="/" className={item(pathname === '/' || pathname === '/store')} style={pathname === '/' || pathname === '/store' ? { color: accent, opacity: 1 } : undefined}>
            <Home className="h-5 w-5" strokeWidth={1.5} />
            Home
          </Link>
          <a href="#all-products" className={item(false)}>
            <LayoutGrid className="h-5 w-5" strokeWidth={1.5} />
            Shop
          </a>
          <button type="button" onClick={onCart} className={item(pathname === '/cart')} aria-label="Bag">
            <span className="relative">
              <ShoppingBag className="h-5 w-5" strokeWidth={1.5} />
              {cartCount > 0 ? (
                <span
                  className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-bold"
                  style={{ backgroundColor: accent, color: chowkOnAccent(accent) }}
                >
                  {cartCount}
                </span>
              ) : null}
            </span>
            Bag
          </button>
          <button type="button" onClick={onSearch} className={item(false)} aria-label="Search">
            <Search className="h-5 w-5" strokeWidth={1.5} />
            Search
          </button>
          <Link href="/account" className={item(pathname === '/account')} style={pathname === '/account' ? { color: accent, opacity: 1 } : undefined}>
            <User className="h-5 w-5" strokeWidth={1.5} />
            Profile
          </Link>
        </div>
      </nav>
    );
  }

  if (chowk) {
    return (
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 border-t bg-white pb-[env(safe-area-inset-bottom)] sm:hidden"
        style={{ borderColor: hair, color: ink }}
      >
        <div className="flex">
          <Link href="/" className={item(pathname === '/' || pathname === '/store')} style={pathname === '/' || pathname === '/store' ? { color: accent, opacity: 1 } : undefined}>
            <Home className="h-5 w-5" strokeWidth={1.75} />
            Home
          </Link>
          <a href="#shop-categories" className={item(false)}>
            <LayoutGrid className="h-5 w-5" strokeWidth={1.75} />
            Categories
          </a>
          <button type="button" onClick={onSearch} className={item(false)} aria-label="Search the shop">
            <Search className="h-5 w-5" strokeWidth={1.75} />
            Search
          </button>
          <a href="#all-products" className={item(false)}>
            <Tag className="h-5 w-5" strokeWidth={1.75} />
            Offers
          </a>
          <Link href="/account" className={item(pathname === '/account')} style={pathname === '/account' ? { color: accent, opacity: 1 } : undefined}>
            <User className="h-5 w-5" strokeWidth={1.75} />
            Account
          </Link>
        </div>
      </nav>
    );
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden">
      <div className="flex">
        <Link href="/" className={item(pathname === '/' || pathname === '/store')} style={pathname === '/' || pathname === '/store' ? { color: accent } : undefined}>
          <Home className="h-5 w-5" />
          Home
        </Link>
        <button type="button" onClick={onSearch} className={item(false)}>
          <Search className="h-5 w-5" />
          Search
        </button>
        <button type="button" onClick={onCart} className={item(pathname === '/cart')} style={pathname === '/cart' ? { color: accent } : undefined}>
          <span className="relative">
            <ShoppingCart className="h-5 w-5" />
            {cartCount > 0 ? (
              <span
                className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-bold text-white"
                style={{ backgroundColor: accent }}
              >
                {cartCount}
              </span>
            ) : null}
          </span>
          Cart
        </button>
        <Link href="/account" className={item(pathname === '/account')} style={pathname === '/account' ? { color: accent } : undefined}>
          <User className="h-5 w-5" />
          Account
        </Link>
      </div>
    </nav>
  );
}
