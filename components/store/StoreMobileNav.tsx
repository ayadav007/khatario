'use client';

import { Home, Search, LayoutGrid, User, ShoppingBag, ShoppingCart, ClipboardList, MoreHorizontal } from 'lucide-react';
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
  const paper = storeCanvas(theme);
  const ink = chowkInkOn(paper);
  const hair = `color-mix(in srgb, ${ink} 12%, transparent)`;
  const home = pathname === '/' || pathname === '/store';

  const item = (active: boolean) =>
    clsx(
      'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium',
      active ? '' : 'opacity-40',
    );
  const on = (active: boolean) => (active ? { color: accent, opacity: 1 } : undefined);

  if (theme.pack === 'grocery') {
    return (
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
        style={{ borderColor: hair, color: ink, backgroundColor: `color-mix(in srgb, ${paper} 92%, transparent)` }}
      >
        <div className="flex">
          <Link href="/" className={item(home)} style={on(home)}>
            <Home className="h-5 w-5" strokeWidth={1.9} />
            Home
          </Link>
          <a href={home ? '#g-categories' : '/#g-categories'} className={item(false)}>
            <LayoutGrid className="h-5 w-5" strokeWidth={1.9} />
            Categories
          </a>
          <button type="button" onClick={onSearch} className={item(false)} aria-label="Search">
            <Search className="h-5 w-5" strokeWidth={1.9} />
            Search
          </button>
          <button type="button" onClick={onCart} className={item(pathname === '/cart')} aria-label="Cart">
            <span className="relative">
              <ShoppingCart className="h-5 w-5" strokeWidth={1.9} />
              {cartCount > 0 ? (
                <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-[#172019]">
                  {cartCount}
                </span>
              ) : null}
            </span>
            Cart
          </button>
          <Link href="/account" className={item(pathname === '/account')} style={on(pathname === '/account')}>
            <User className="h-5 w-5" strokeWidth={1.9} />
            Account
          </Link>
        </div>
      </nav>
    );
  }

  if (theme.pack === 'khatario') {
    return (
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-black/5 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-4 gap-1 px-2 pt-2">
          <Link href="/" className={item(home)} style={on(home)}>
            <Home className="h-5 w-5" />
            Home
          </Link>
          <button type="button" onClick={onCart} className={item(pathname === '/cart')} style={on(pathname === '/cart')}>
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
          <Link href="/account" className={item(pathname === '/account')} style={on(pathname === '/account')}>
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

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] sm:hidden"
      style={{ borderColor: hair, color: ink, backgroundColor: paper }}
    >
      <div className="flex">
        <Link href="/" className={item(home)} style={on(home)}>
          <Home className="h-5 w-5" strokeWidth={1.75} />
          Home
        </Link>
        <a href={home ? '#st-categories' : '/#st-categories'} className={item(false)}>
          <LayoutGrid className="h-5 w-5" strokeWidth={1.75} />
          Categories
        </a>
        <button type="button" onClick={onSearch} className={item(false)} aria-label="Search">
          <Search className="h-5 w-5" strokeWidth={1.75} />
          Search
        </button>
        <button type="button" onClick={onCart} className={item(pathname === '/cart')} aria-label="Cart">
          <span className="relative">
            <ShoppingCart className="h-5 w-5" strokeWidth={1.75} />
            {cartCount > 0 ? (
              <span
                className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold"
                style={{ backgroundColor: accent, color: chowkOnAccent(accent) }}
              >
                {cartCount}
              </span>
            ) : null}
          </span>
          Cart
        </button>
        <Link href="/account" className={item(pathname === '/account')} style={on(pathname === '/account')}>
          <User className="h-5 w-5" strokeWidth={1.75} />
          Account
        </Link>
      </div>
    </nav>
  );
}
