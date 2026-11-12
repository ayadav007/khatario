'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowRight,
  BookOpen,
  Bot,
  Calculator,
  Camera,
  CalendarCheck,
  ChevronDown,
  FileText,
  HeartHandshake,
  HelpCircle,
  Inbox,
  Megaphone,
  Menu,
  MessageCircle,
  Package,
  Palette,
  PlayCircle,
  Sparkles,
  Store,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { useOptionalLandingProduct } from '@/components/marketing/landing/LandingProductContext';
import { getSignupHref, type ProductLine } from '@/lib/product-lines';
import { DEFAULT_ANNOUNCEMENT, type SiteAnnouncement } from '@/lib/marketing-builder/announcement';

/* Menu content ---------------------------------------------------------------- */

type MenuLink = { label: string; text: string; icon: LucideIcon; href: string };

type ProductMenu = {
  line: ProductLine;
  label: string;
  tagline: string;
  icon: LucideIcon;
  /** Tile colours for the product's icon. */
  tile: string;
  pitch: string;
  cta: string;
  links: MenuLink[];
};

const PRODUCT_MENUS: ProductMenu[] = [
  {
    line: 'billing',
    label: 'Billing',
    tagline: 'GST billing, stock & online store',
    icon: FileText,
    tile: 'bg-primary-600 text-white',
    pitch: 'Unlimited GST bills on the Free plan. Upgrade when the shop grows.',
    cta: 'Start Billing free',
    links: [
      { label: 'GST billing', text: 'Bills in seconds, on WhatsApp', icon: FileText, href: '/#tour' },
      { label: 'Inventory', text: 'Stock that updates itself', icon: Package, href: '/solution/inventory' },
      { label: 'Accounting', text: 'Ledgers, P&L, GSTR files', icon: Calculator, href: '/solution/accounting' },
      { label: 'Scan purchase bills', text: 'Photo of a supplier bill fills the entry', icon: Camera, href: '/#ai' },
      { label: 'Ask Khatario AI', text: '“How was sale today?” answered', icon: Sparkles, href: '/#ai' },
      { label: 'Payments', text: 'UPI on every bill, reminders', icon: Wallet, href: '/#tour' },
      { label: 'Online store', text: 'Orders arrive as bills', icon: Store, href: '/#store' },
      { label: 'Store themes', text: 'Ready-made shop designs', icon: Palette, href: '/themes' },
    ],
  },
  {
    line: 'hr',
    label: 'HR',
    tagline: 'Attendance, payroll & leave',
    icon: Users,
    tile: 'bg-sky-600 text-white',
    pitch: 'Free for up to 30 staff with any Billing plan, or on its own.',
    cta: 'Start HR trial',
    links: [
      { label: 'Phone check-in', text: 'Fake GPS and emulators blocked', icon: CalendarCheck, href: '/?product=hr#staff' },
      { label: 'Payroll', text: 'Salary worked out from attendance', icon: Wallet, href: '/?product=hr#staff' },
      { label: 'Leave', text: 'Requests and approvals', icon: Users, href: '/?product=hr#staff' },
    ],
  },
  {
    line: 'connect',
    label: 'Connect',
    tagline: 'WhatsApp marketing & inbox',
    icon: MessageCircle,
    tile: 'bg-emerald-600 text-white',
    pitch: 'Your own Meta account on the official API. You pay Meta directly, we add no markup.',
    cta: 'Create Connect account',
    links: [
      { label: 'Campaigns', text: 'Festival offers to the right customers', icon: Megaphone, href: '/?product=connect#whatsapp' },
      { label: 'Shared inbox', text: 'One number, many staff replying', icon: Inbox, href: '/?product=connect#whatsapp' },
      { label: 'Bot & AI replies', text: 'Answers stock questions at night', icon: Bot, href: '/?product=connect#whatsapp' },
    ],
  },
];

const RESOURCE_LINKS: MenuLink[] = [
  { label: 'Blog', text: 'GST, billing and shop tips', icon: BookOpen, href: '/blog' },
  { label: 'Guides', text: 'Step-by-step how-tos', icon: HelpCircle, href: '/guides' },
  { label: 'Book a demo', text: 'See it on your own data', icon: PlayCircle, href: '/book-demo' },
  { label: 'Partners', text: 'Earn by referring shops', icon: HeartHandshake, href: '/partners' },
];

/* Pieces ---------------------------------------------------------------------- */

function MenuLinkRow({ link, onNavigate }: { link: MenuLink; onNavigate: (href: string) => void }) {
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      onClick={(e) => {
        e.preventDefault();
        onNavigate(link.href);
      }}
      className="group/link flex items-start gap-3 rounded-xl p-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/70"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700 transition-colors group-hover/link:bg-primary-600 group-hover/link:text-white dark:bg-slate-800 dark:text-slate-200">
        <Icon className="h-[1.1rem] w-[1.1rem]" strokeWidth={1.9} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-slate-900 dark:text-slate-50">{link.label}</span>
        <span className="block text-[13px] leading-snug text-slate-600 dark:text-slate-400">{link.text}</span>
      </span>
    </Link>
  );
}

function ProductPanel({
  menu,
  onNavigate,
  onPickProduct,
}: {
  menu: ProductMenu;
  onNavigate: (href: string) => void;
  onPickProduct: (line: ProductLine) => void;
}) {
  const Icon = menu.icon;
  return (
    <div className="grid w-[min(46rem,calc(100vw-2rem))] grid-cols-[1fr_15rem] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15 dark:border-slate-700 dark:bg-slate-900">
      <div className="p-4">
        <p className="px-2.5 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Khatario {menu.label}
        </p>
        <div className="grid grid-cols-2 gap-0.5">
          {menu.links.map((l) => (
            <MenuLinkRow key={l.label} link={l} onNavigate={onNavigate} />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3 bg-primary-600 p-5 text-white">
        <span className={clsx('grid h-11 w-11 place-items-center rounded-xl ring-2 ring-white/20', menu.tile)}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <p className="text-lg font-bold leading-tight">{menu.tagline}</p>
        <p className="text-sm leading-relaxed text-primary-100">{menu.pitch}</p>
        <button
          type="button"
          onClick={() => onPickProduct(menu.line)}
          className="mt-auto inline-flex items-center gap-1.5 self-start text-sm font-semibold text-accent-300 hover:text-accent-200"
        >
          See {menu.label} <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
        <Link
          href={getSignupHref(menu.line)}
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-accent-500 px-4 text-sm font-semibold text-slate-950 hover:bg-accent-400"
        >
          {menu.cta}
        </Link>
      </div>
    </div>
  );
}

function AnnouncementBar({ announcement }: { announcement: SiteAnnouncement }) {
  const a = announcement;
  if (!a.show || (!a.title && !a.text)) return null;
  return (
    <div className="relative z-[51] bg-primary-600 text-white">
      <div className={clsx(LANDING_PAGE_GUTTER, 'flex min-h-[2.5rem] items-center justify-center gap-3 py-2 text-center text-sm')}>
        {a.badge && (
          <span className="marketing-pill-shine rounded-full px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-slate-950">
            {a.badge}
          </span>
        )}
        <span className="text-primary-100">
          {a.title && <span className="font-semibold text-white">{a.title}</span>}
          {a.text && <span className="hidden sm:inline"> {a.text}</span>}
        </span>
        {a.linkLabel && a.href && (
          <Link href={a.href} className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-accent-300 hover:text-accent-200">
            {a.linkLabel} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}

/* Header ---------------------------------------------------------------------- */

type MenuId = ProductLine | 'resources';

export function MarketingSiteHeader({
  announcement = DEFAULT_ANNOUNCEMENT,
  preview = false,
}: {
  /** The bar above the header; the home page passes what was set in the Site Builder. */
  announcement?: SiteAnnouncement;
  /** Inside the Site Builder canvas: not sticky, so it never covers the blocks being edited. */
  preview?: boolean;
} = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const product = useOptionalLandingProduct();
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<MenuId | null>('billing');
  const [scrolled, setScrolled] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const navRef = useRef<HTMLElement>(null);

  const onHome = pathname === '/';
  const activeLine = onHome && product ? product.productLine : null;

  const closeAll = useCallback(() => {
    setOpenMenu(null);
    setMobileOpen(false);
  }, []);

  /** On the home page a product link switches the page in place; elsewhere it navigates. */
  const navigate = useCallback(
    (href: string) => {
      closeAll();
      const url = new URL(href, window.location.origin);
      const line = url.searchParams.get('product') as ProductLine | null;
      if (url.pathname === '/' && onHome) {
        if (product) product.setProductLine(line ?? product.productLine);
        const target = url.hash ? document.getElementById(url.hash.slice(1)) : null;
        if (target) target.scrollIntoView({ behavior: 'smooth' });
        else if (line) window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      router.push(href);
    },
    [closeAll, onHome, product, router],
  );

  const pickProduct = useCallback((line: ProductLine) => navigate(`/?product=${line}`), [navigate]);

  const openSoon = (id: MenuId) => {
    window.clearTimeout(closeTimer.current);
    setOpenMenu(id);
  };
  const closeSoon = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpenMenu(null), 140);
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    closeAll();
  }, [pathname, closeAll]);

  useEffect(() => {
    if (!openMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [mobileOpen]);

  const topItem = (id: MenuId, label: string, panel: React.ReactNode, active = false) => (
    <div key={id} onMouseEnter={() => openSoon(id)} onMouseLeave={closeSoon}>
      <button
        type="button"
        aria-expanded={openMenu === id}
        aria-haspopup="true"
        onClick={() => setOpenMenu((v) => (v === id ? null : id))}
        className={clsx(
          'relative flex items-center gap-1 rounded-lg px-3.5 py-2 text-[15px] font-semibold transition-colors xl:px-4',
          openMenu === id
            ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
            : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/60',
        )}
      >
        {label}
        <ChevronDown
          className={clsx('h-4 w-4 text-slate-400 transition-transform', openMenu === id && 'rotate-180')}
          aria-hidden
        />
        {active && <span className="absolute inset-x-3.5 -bottom-0.5 h-0.5 rounded-full bg-accent-500" aria-hidden />}
      </button>
      {openMenu === id && (
        // Centred under the whole nav (not the item) so wide panels never run off the screen.
        <div className="absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2">
          <div className="animate-marketing-menu-in">{panel}</div>
        </div>
      )}
    </div>
  );

  const plainLink = (href: string, label: string, current: boolean) => (
    <Link
      href={href}
      onClick={(e) => {
        if (href.startsWith('/#')) {
          e.preventDefault();
          navigate(href);
        }
      }}
      aria-current={current ? 'page' : undefined}
      className={clsx(
        'rounded-lg px-3.5 py-2 text-[15px] font-semibold transition-colors xl:px-4',
        current
          ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
          : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/60',
      )}
    >
      {label}
    </Link>
  );

  return (
    <>
      <AnnouncementBar announcement={announcement} />
      <header
        className={clsx(
          preview ? 'relative z-50' : 'sticky top-0 z-50',
          'border-b bg-white/85 backdrop-blur-xl transition-shadow dark:bg-slate-950/85',
          scrolled
            ? 'border-slate-200 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.18)] dark:border-slate-800'
            : 'border-transparent',
        )}
      >
        <div className={LANDING_PAGE_GUTTER}>
          <div
            className={clsx(
              'flex w-full items-center justify-between gap-4 transition-[min-height] duration-200',
              scrolled ? 'min-h-[4rem]' : 'min-h-[4.75rem]',
            )}
          >
            <Link href="/" className="flex shrink-0 items-center" onClick={closeAll}>
              <img src="/brand/khatario-wordmark.png" alt="Khatario" className="h-10 w-auto sm:h-11 dark:hidden" />
              <img src="/brand/khatario-wordmark-light.png" alt="" className="hidden h-10 w-auto sm:h-11 dark:block" />
            </Link>

            <nav ref={navRef} className="relative hidden flex-1 items-center justify-center gap-0.5 lg:flex" aria-label="Main">
              {PRODUCT_MENUS.map((m) =>
                topItem(
                  m.line,
                  m.label,
                  <ProductPanel menu={m} onNavigate={navigate} onPickProduct={pickProduct} />,
                  activeLine === m.line,
                ),
              )}
              {plainLink('/themes', 'Themes', !!pathname?.startsWith('/themes'))}
              {plainLink('/pricing', 'Pricing', pathname === '/pricing')}
              {topItem(
                'resources',
                'Resources',
                <div className="w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-900/15 dark:border-slate-700 dark:bg-slate-900">
                  <div className="grid grid-cols-2 gap-0.5">
                    {RESOURCE_LINKS.map((l) => (
                      <MenuLinkRow key={l.label} link={l} onNavigate={navigate} />
                    ))}
                  </div>
                </div>,
              )}
            </nav>

            <div className="hidden shrink-0 items-center gap-2 lg:flex">
              <Link
                href="/login"
                className="rounded-lg px-3.5 py-2 text-[15px] font-semibold text-slate-700 hover:text-primary-600 dark:text-slate-200"
              >
                Log in
              </Link>
              <Link
                href="/book-demo"
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-[15px] font-semibold text-slate-800 transition hover:border-primary-600 hover:text-primary-600 dark:border-slate-600 dark:text-slate-100"
              >
                Book demo
              </Link>
              <Link
                href={getSignupHref(activeLine ?? 'billing')}
                className="landing-cta-shimmer group inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-[15px] font-semibold text-white shadow-md shadow-primary-600/20 transition hover:shadow-lg"
              >
                Start free
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </div>

            <div className="flex items-center gap-2 lg:hidden">
              <Link
                href={getSignupHref(activeLine ?? 'billing')}
                className="landing-cta-shimmer whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
              >
                Start free
              </Link>
              <button
                type="button"
                className="grid h-11 w-11 place-items-center rounded-xl text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                aria-expanded={mobileOpen}
                aria-label="Open menu"
                onClick={() => setMobileOpen(true)}
              >
                <Menu className="h-6 w-6" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            className="animate-marketing-nav-backdrop-in absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <nav
            className="animate-marketing-nav-panel-in absolute inset-x-0 top-0 flex max-h-[100dvh] flex-col overflow-y-auto overscroll-contain rounded-b-3xl bg-white px-4 pb-6 pt-3 shadow-2xl dark:bg-slate-950"
            aria-label="Mobile"
          >
            <div className="flex items-center justify-between">
              <Link href="/" onClick={closeAll}>
                <img src="/brand/khatario-wordmark.png" alt="Khatario" className="h-10 w-auto dark:hidden" />
                <img src="/brand/khatario-wordmark-light.png" alt="" className="hidden h-10 w-auto dark:block" />
              </Link>
              <button
                type="button"
                className="grid h-11 w-11 place-items-center rounded-xl text-slate-800 hover:bg-slate-100 dark:text-slate-100"
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
              >
                <X className="h-6 w-6" aria-hidden />
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {PRODUCT_MENUS.map((m) => {
                const Icon = m.icon;
                const open = mobileSection === m.line;
                return (
                  <div key={m.line} className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setMobileSection(open ? null : m.line)}
                      className="flex w-full items-center gap-3 px-3 py-3 text-left"
                    >
                      <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', m.tile)}>
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold text-slate-900 dark:text-white">{m.label}</span>
                        <span className="block text-[13px] text-slate-600 dark:text-slate-400">{m.tagline}</span>
                      </span>
                      <ChevronDown
                        className={clsx('h-5 w-5 text-slate-400 transition-transform', open && 'rotate-180')}
                        aria-hidden
                      />
                    </button>
                    {open && (
                      <div className="border-t border-slate-100 px-1.5 pb-2 pt-1 dark:border-slate-800">
                        {m.links.map((l) => (
                          <MenuLinkRow key={l.label} link={l} onNavigate={navigate} />
                        ))}
                        <Link
                          href={getSignupHref(m.line)}
                          onClick={closeAll}
                          className="mx-2.5 mt-1 flex min-h-[44px] items-center justify-center rounded-xl bg-primary-600 text-sm font-semibold text-white"
                        >
                          {m.cta}
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-1 border-t border-slate-200 pt-3 dark:border-slate-700">
              {[
                { href: '/themes', label: 'Themes' },
                { href: '/pricing', label: 'Pricing' },
                ...RESOURCE_LINKS.map((l) => ({ href: l.href, label: l.label })),
              ].map((l) => (
                <Link
                  key={l.label}
                  href={l.href}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(l.href);
                  }}
                  className="rounded-lg px-3 py-3 text-[15px] font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-100"
                >
                  {l.label}
                </Link>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link
                href="/login"
                onClick={closeAll}
                className="flex min-h-[48px] items-center justify-center rounded-xl border border-slate-300 font-semibold text-slate-800 dark:border-slate-600 dark:text-slate-100"
              >
                Log in
              </Link>
              <Link
                href={getSignupHref(activeLine ?? 'billing')}
                onClick={closeAll}
                className="flex min-h-[48px] items-center justify-center rounded-xl bg-accent-500 font-semibold text-slate-950"
              >
                Start free
              </Link>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
