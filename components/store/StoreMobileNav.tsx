'use client';

import { Home, Search, ShoppingCart, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useStore } from '@/lib/store/store-context';
import { sanitizeStoreTheme } from '@/lib/store/store-theme';

export function StoreMobileNav({
  onSearch,
  onCart,
}: {
  onSearch?: () => void;
  onCart?: () => void;
}) {
  const pathname = usePathname();
  const { cartCount, store } = useStore();
  const accent = sanitizeStoreTheme(store?.store_theme).accent;

  const item = (active: boolean) =>
    clsx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium', active ? '' : 'text-gray-400');

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
