'use client';

import { Home, Search, ShoppingCart, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useStore } from '@/lib/store/store-context';
import { chowkInkOn, sanitizeStoreTheme } from '@/lib/store/store-theme';

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
  const ink = chowkInkOn(theme.background);
  const hair = `color-mix(in srgb, ${ink} 12%, transparent)`;

  const item = (active: boolean) =>
    clsx(
      'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium',
      active ? '' : chowk ? 'opacity-40' : 'text-gray-400',
    );

  return (
    <nav
      className={clsx(
        'fixed bottom-0 left-0 right-0 z-40 pb-[env(safe-area-inset-bottom)] sm:hidden',
        chowk ? 'border-t' : 'border-t border-gray-200 bg-white',
      )}
      style={chowk ? { backgroundColor: theme.background, borderColor: hair, color: ink } : undefined}
    >
      <div className="flex">
        <Link href="/" className={item(pathname === '/' || pathname === '/store')} style={chowk && (pathname === '/' || pathname === '/store') ? { color: ink, opacity: 1 } : pathname === '/' || pathname === '/store' ? { color: accent } : undefined}>
          <Home className="h-5 w-5" strokeWidth={chowk ? 1.5 : 2} />
          Home
        </Link>
        <button type="button" onClick={onSearch} className={item(false)} aria-label={chowk ? 'Search the shop' : 'Search'}>
          <Search className="h-5 w-5" strokeWidth={chowk ? 1.5 : 2} />
          {chowk ? 'Find' : 'Search'}
        </button>
        <button type="button" onClick={onCart} className={item(pathname === '/cart')} style={chowk && pathname === '/cart' ? { color: ink, opacity: 1 } : pathname === '/cart' ? { color: accent } : undefined}>
          <span className="relative">
            <ShoppingCart className="h-5 w-5" strokeWidth={chowk ? 1.5 : 2} />
            {!chowk && cartCount > 0 ? (
              <span
                className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-bold text-white"
                style={{ backgroundColor: accent }}
              >
                {cartCount}
              </span>
            ) : null}
          </span>
          {chowk ? (
            <span>
              Bag
              {cartCount > 0 ? (
                <span className="tabular-nums" style={{ color: accent }}>
                  {' '}
                  {cartCount}
                </span>
              ) : null}
            </span>
          ) : (
            'Cart'
          )}
        </button>
        <Link href="/account" className={item(pathname === '/account')} style={chowk && pathname === '/account' ? { color: ink, opacity: 1 } : pathname === '/account' ? { color: accent } : undefined}>
          <User className="h-5 w-5" strokeWidth={chowk ? 1.5 : 2} />
          Account
        </Link>
      </div>
    </nav>
  );
}
