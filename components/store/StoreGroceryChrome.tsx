'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { Heart, MapPin, Search, ShoppingCart, User } from 'lucide-react';
import { marqueeItems } from '@/lib/store/grocery';
import { chowkOnAccent, hexLuminance, resolveAnnouncementText, type StoreTheme } from '@/lib/store/store-theme';

type StoreInfo = {
  name: string;
  store_tagline: string | null;
  phone: string | null;
  email: string | null;
  store_hide_khatario_badge: boolean;
};

/** Dark brand green used by the marquee and footer, following the merchant's accent. */
export function groceryDeep(accent: string): string {
  return `color-mix(in srgb, ${accent} 30%, #07140d)`;
}

export function GroceryMarquee({ theme, fallback }: { theme: StoreTheme; fallback: string }) {
  const text = resolveAnnouncementText(theme, fallback);
  const items = marqueeItems(text);
  if (items.length === 0) return null;
  const loop = [...items, ...items, ...items, ...items];
  const bg = theme.announcement_bg || groceryDeep(theme.accent);
  const fg = theme.announcement_fg || 'rgba(255,255,255,0.88)';
  const body = (
    <div className="store-grocery-marquee flex w-max items-center gap-8 py-2 text-[12px] font-semibold">
      {loop.map((bit, i) => (
        <span key={`${bit}-${i}`} className="flex items-center gap-8 whitespace-nowrap">
          {bit}
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
        </span>
      ))}
    </div>
  );
  const link = theme.announcement_link;
  return (
    <div className="overflow-hidden" style={{ backgroundColor: bg, color: fg }} aria-label={text}>
      {link ? (
        <a href={link} {...(/^https?:\/\//i.test(link) ? { target: '_blank', rel: 'noreferrer' } : {})}>
          {body}
        </a>
      ) : (
        body
      )}
    </div>
  );
}

export function GroceryHeader({
  store,
  theme,
  logoUrl,
  paper,
  ink,
  home,
  showSearch,
  searchQuery,
  searchPlaceholder,
  searchRef,
  onSearchChange,
  cartCount,
  onCart,
  customerInitial,
  onToggleArea,
  areaLabel,
  branchPanel,
  subnav,
}: {
  store: StoreInfo;
  theme: StoreTheme;
  logoUrl: string | null;
  paper: string;
  ink: string;
  home: boolean;
  showSearch: boolean;
  searchQuery: string;
  searchPlaceholder: string;
  searchRef: RefObject<HTMLInputElement>;
  onSearchChange?: (q: string) => void;
  cartCount: number;
  onCart: () => void;
  customerInitial: string | null;
  onToggleArea: () => void;
  areaLabel: string;
  branchPanel: ReactNode;
  subnav?: ReactNode;
}) {
  const accent = theme.accent;
  const onAccent = chowkOnAccent(accent);
  const dark = hexLuminance(paper) < 0.4;
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const anchor = (id: string) => (home ? `#${id}` : `/#${id}`);
  const iconBtn = 'g-line relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors';
  const iconStyle = { backgroundColor: dark ? 'rgba(255,255,255,0.06)' : '#fff' };

  const searchBox = (id: string, className: string) => (
    <form
      role="search"
      className={clsx('relative', className)}
      onSubmit={(e) => {
        e.preventDefault();
        document.getElementById('all-products')?.scrollIntoView({ behavior: 'smooth' });
      }}
    >
      <input
        id={id}
        ref={id === 'store-search' ? searchRef : undefined}
        type="search"
        value={searchQuery}
        onChange={(e) => onSearchChange?.(e.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        enterKeyHint="search"
        autoComplete="off"
        className="g-line h-11 w-full rounded-full border py-2 pl-5 pr-14 text-sm outline-none transition-shadow focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--store-accent)_18%,transparent)]"
        style={{ backgroundColor: dark ? 'rgba(255,255,255,0.06)' : '#fff', color: ink }}
      />
      <button
        type="submit"
        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full"
        style={{ backgroundColor: accent, color: onAccent }}
        aria-label="Search"
      >
        <Search className="h-4 w-4" strokeWidth={2.2} />
      </button>
    </form>
  );

  return (
    <header
      className={clsx('backdrop-blur-xl transition-shadow', scrolled && 'shadow-[0_8px_30px_rgba(21,35,27,0.08)]')}
      style={{ backgroundColor: `color-mix(in srgb, ${dark ? paper : '#ffffff'} 88%, transparent)`, color: ink }}
    >
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex items-center gap-3 py-3 md:gap-6 md:py-4">
          <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2.5">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-10 w-10 rounded-xl bg-white object-contain p-1" />
            ) : (
              <span
                className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-black"
                style={{ backgroundColor: accent, color: onAccent }}
              >
                {store.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            {!logoUrl || theme.show_store_name ? (
              <span className="min-w-0">
                <span className="block max-w-[11rem] truncate text-lg font-extrabold leading-tight tracking-tight sm:max-w-[16rem]">
                  {store.name}
                </span>
                {store.store_tagline ? (
                  <span className="hidden max-w-[16rem] truncate text-[11px] lg:block" style={{ opacity: 0.55 }}>
                    {store.store_tagline}
                  </span>
                ) : null}
              </span>
            ) : null}
          </Link>

          {showSearch ? searchBox('store-search-desktop', 'hidden min-w-0 flex-1 md:block') : <div className="hidden flex-1 md:block" />}

          <nav className="hidden items-center gap-5 text-sm font-semibold lg:flex" style={{ opacity: 0.8 }}>
            <a href={anchor('all-products')} className="hover:opacity-100" style={{ color: 'inherit' }}>
              Products
            </a>
            <a href={anchor('g-categories')}>Categories</a>
            <a href={anchor('g-offers')}>Offers</a>
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <button
              type="button"
              onClick={onToggleArea}
              className={clsx(iconBtn, 'hidden sm:flex')}
              style={iconStyle}
              aria-label={`Delivery area: ${areaLabel}`}
              title={areaLabel}
            >
              <MapPin className="h-[18px] w-[18px]" />
            </button>
            <Link href="/wishlist" className={clsx(iconBtn, 'hidden sm:flex')} style={iconStyle} aria-label="Wishlist">
              <Heart className="h-[18px] w-[18px]" />
            </Link>
            <Link href="/account" className={clsx(iconBtn, 'hidden sm:flex')} style={iconStyle} aria-label="Account">
              {customerInitial ? <span className="text-sm font-bold">{customerInitial}</span> : <User className="h-[18px] w-[18px]" />}
            </Link>
            <button
              type="button"
              onClick={onCart}
              className={iconBtn}
              style={iconStyle}
              aria-label={cartCount > 0 ? `Cart, ${cartCount} items` : 'Cart'}
            >
              <ShoppingCart className="h-[18px] w-[18px]" />
              {cartCount > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-extrabold text-[#172019]">
                  {cartCount}
                </span>
              ) : null}
            </button>
          </div>
        </div>

        {showSearch ? searchBox('store-search', 'pb-3 md:hidden') : null}
        {branchPanel ? <div className="pb-3">{branchPanel}</div> : null}
      </div>
      {subnav ? (
        <div className="g-line border-t">
          <div className="mx-auto max-w-7xl px-4">{subnav}</div>
        </div>
      ) : null}
    </header>
  );
}

export function GroceryFooter({ store, accent }: { store: StoreInfo; accent: string }) {
  const year = new Date().getFullYear();
  const col = 'flex flex-col gap-2 text-[13px]';
  const head = 'mb-1 text-[13px] font-bold text-white';
  return (
    <footer
      className="mt-16 text-white/65"
      style={{ backgroundColor: groceryDeep(accent), paddingBottom: 'var(--chowk-chrome)' }}
    >
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xl font-extrabold tracking-tight text-white">{store.name}</p>
          {store.store_tagline ? <p className="mt-3 max-w-xs text-[13px] leading-relaxed">{store.store_tagline}</p> : null}
        </div>
        <div className={col}>
          <p className={head}>Shop</p>
          <a href="/#all-products" className="hover:text-white">All products</a>
          <a href="/#g-categories" className="hover:text-white">Categories</a>
          <a href="/#g-offers" className="hover:text-white">Offers</a>
          <Link href="/wishlist" className="hover:text-white">Wishlist</Link>
        </div>
        <div className={col}>
          <p className={head}>Help</p>
          <Link href="/account" className="hover:text-white">Your orders</Link>
          <Link href="/contact" className="hover:text-white">Contact us</Link>
          <Link href="/refund" className="hover:text-white">Refunds</Link>
          <Link href="/terms" className="hover:text-white">Terms</Link>
          <Link href="/privacy" className="hover:text-white">Privacy</Link>
        </div>
        <div className={col}>
          <p className={head}>Get in touch</p>
          {store.phone ? <a href={`tel:${store.phone}`} className="hover:text-white">{store.phone}</a> : null}
          {store.email ? <a href={`mailto:${store.email}`} className="break-all hover:text-white">{store.email}</a> : null}
          <Link href="/about" className="hover:text-white">About us</Link>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[12px]">
          <span>© {year} {store.name}</span>
          {store.store_hide_khatario_badge ? null : <span>Powered by Khatario</span>}
        </div>
      </div>
    </footer>
  );
}
