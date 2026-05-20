'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  Calculator,
  FileText,
  Gem,
  HelpCircle,
  Package,
  ScanLine,
  Shirt,
  ShoppingCart,
  Store,
  UtensilsCrossed,
  UserCircle,
  Video,
  Pill,
  FileBadge2,
  LayoutGrid,
  Flag,
  ChevronDown,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';

type MegaLink = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const BUSINESS_LINKS: MegaLink[] = [
  { href: '/solution/accounting', label: 'Accounting', icon: Calculator },
  { href: '/solution/inventory', label: 'Inventory', icon: Package },
  { href: '/#solution-invoicing', label: 'Invoicing', icon: FileText },
  { href: '/#solution-invoicing', label: 'E-Invoice', icon: FileBadge2 },
  { href: '/#solution-thermal', label: 'POS', icon: LayoutGrid },
  { href: '/guides', label: 'OCR', icon: ScanLine },
];

const INDUSTRY_LINKS: MegaLink[] = [
  { href: '/#solution-customers', label: 'Retail', icon: Store },
  { href: '/#solution-inventory', label: 'Pharmacy', icon: Pill },
  { href: '/#solution-invoicing', label: 'Grocery', icon: ShoppingCart },
  { href: '/#solution-whatsapp', label: 'Restaurant', icon: UtensilsCrossed },
  { href: '/#solution-thermal', label: 'Jewellery', icon: Gem },
  { href: '/#solution-customers', label: 'Clothing/Apparel', icon: Shirt },
];

const RESOURCE_LINKS: MegaLink[] = [
  { href: '/guides', label: 'Blogs', icon: BookOpen },
  { href: '/guides', label: 'Use Cases', icon: UserCircle },
  { href: '/guides', label: 'Guides', icon: HelpCircle },
  { href: '/#pricing', label: 'Success Stories', icon: Flag },
  { href: '/guides', label: 'Videos', icon: Video },
];

const MOBILE_SOLUTION_SECTIONS: { id: string; title: string; links: MegaLink[] }[] = [
  { id: 'business', title: 'Business', links: BUSINESS_LINKS },
  { id: 'industry', title: 'Industry', links: INDUSTRY_LINKS },
  { id: 'resources', title: 'Resources', links: RESOURCE_LINKS },
];

function MegaMenuLinkRow({
  href,
  label,
  icon: Icon,
  onNavigate,
  compact,
}: MegaLink & { onNavigate?: () => void; compact?: boolean }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={clsx(
        'flex items-center rounded-lg text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/80',
        compact ? 'gap-2.5 px-2 py-2 text-sm' : 'gap-3 px-2 py-3 text-lg lg:text-xl'
      )}
    >
      <span
        className={clsx(
          'flex flex-shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400',
          compact ? 'h-8 w-8' : 'h-11 w-11 sm:h-12 sm:w-12'
        )}
        aria-hidden
      >
        <Icon className={compact ? 'h-4 w-4' : 'h-5 w-5 sm:h-[1.35rem] sm:w-[1.35rem]'} strokeWidth={1.75} />
      </span>
      <span className="font-medium">{label}</span>
    </Link>
  );
}

function MegaMenuPanel({ onNavigate }: { onNavigate?: () => void }) {
  const col = (title: string, links: MegaLink[]) => (
    <div className="min-w-0 flex-1">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 sm:text-base">
        {title}
      </p>
      <ul className="space-y-0.5">
        {links.map((link) => (
          <li key={`${title}-${link.label}`}>
            <MegaMenuLinkRow {...link} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div
      className={clsx(
        'rounded-2xl border border-slate-200/90 bg-white p-6 shadow-lg dark:border-slate-700 dark:bg-slate-900 sm:p-7 lg:p-8',
        'flex flex-col gap-8 lg:flex-row lg:gap-12'
      )}
    >
      {col('Business management solutions', BUSINESS_LINKS)}
      {col('Industry solution', INDUSTRY_LINKS)}
      {col('Resources', RESOURCE_LINKS)}
    </div>
  );
}

function MobileSolutionNav({ onNavigate }: { onNavigate?: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      {MOBILE_SOLUTION_SECTIONS.map((section, index) => {
        const isOpen = openId === section.id;
        const panelId = `mobile-solution-${section.id}`;

        return (
          <div
            key={section.id}
            className={clsx(index > 0 && 'border-t border-slate-200 dark:border-slate-700')}
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left text-sm font-semibold text-slate-800 dark:text-slate-100"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenId(isOpen ? null : section.id)}
            >
              {section.title}
              <ChevronDown
                className={clsx('h-4 w-4 shrink-0 text-slate-500 transition-transform', isOpen && 'rotate-180')}
                aria-hidden
              />
            </button>
            {isOpen && (
              <ul id={panelId} className="space-y-0.5 border-t border-slate-100 px-1 pb-2 pt-1 dark:border-slate-800">
                {section.links.map((link) => (
                  <li key={`${section.id}-${link.label}`}>
                    <MegaMenuLinkRow {...link} onNavigate={onNavigate} compact />
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function MarketingSiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [megaOpen, setMegaOpen] = useState(false);
  const megaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!megaOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (megaRef.current && !megaRef.current.contains(e.target as Node)) {
        setMegaOpen(false);
      }
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [megaOpen]);

  useEffect(() => {
    setMobileOpen(false);
    setMegaOpen(false);
  }, [pathname]);

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

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-950/90">
      <div className={LANDING_PAGE_GUTTER}>
        <div
          className={clsx(
            'relative z-[52] flex min-h-[5.25rem] w-full items-center justify-between gap-4 py-3.5 sm:min-h-[5.75rem] sm:py-4'
          )}
        >
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 text-slate-900 dark:text-slate-50"
          onClick={() => setMobileOpen(false)}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-600 text-lg font-bold text-white sm:h-14 sm:w-14 sm:text-xl">
            K
          </span>
          <span className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-[2rem] lg:leading-none">
            Khatario
          </span>
        </Link>

        {/* Desktop nav — centered in remaining width */}
        <nav
          className="hidden flex-1 items-center justify-center gap-1 px-4 lg:gap-2 xl:px-8 md:flex"
          aria-label="Main"
        >
          <div ref={megaRef} className="group relative">
            <button
              type="button"
              className={clsx(
                'flex items-center gap-1 rounded-lg px-5 py-3 text-lg font-medium transition-colors lg:px-6 lg:py-3.5 lg:text-xl',
                megaOpen
                  ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-50'
                  : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/60'
              )}
              aria-expanded={megaOpen}
              aria-haspopup="true"
              onMouseEnter={() => setMegaOpen(true)}
              onFocus={() => setMegaOpen(true)}
              onClick={() => setMegaOpen((v) => !v)}
            >
              Solution
            </button>
            {/* Hover bridge */}
            <div
              className="absolute left-0 right-0 top-full h-2 bg-transparent"
              aria-hidden
              onMouseEnter={() => setMegaOpen(true)}
            />
            <div
              className={clsx(
                'absolute left-1/2 top-full z-50 mt-2 hidden w-[min(90rem,calc(100vw-2.5rem))] -translate-x-1/2 pt-0',
                'group-hover:block',
                megaOpen && '!block'
              )}
              onMouseLeave={() => setMegaOpen(false)}
            >
              <MegaMenuPanel onNavigate={() => setMegaOpen(false)} />
            </div>
          </div>

          <Link
            href="/#pricing"
            className="rounded-lg px-5 py-3 text-lg font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/60 lg:px-6 lg:py-3.5 lg:text-xl"
          >
            Pricing
          </Link>
          <Link
            href="/book-demo"
            className="rounded-lg px-5 py-3 text-lg font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/60 lg:px-6 lg:py-3.5 lg:text-xl"
          >
            Book demo
          </Link>
        </nav>

        <div className="hidden shrink-0 items-center gap-3 md:flex lg:gap-4">
          <Link
            href="/login"
            className="rounded-lg px-4 py-3 text-lg font-medium text-slate-700 hover:text-primary-600 dark:text-slate-200 dark:hover:text-primary-400 lg:px-5 lg:py-3.5 lg:text-xl"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="rounded-xl bg-primary-600 px-7 py-3 text-lg font-semibold text-white shadow-sm hover:bg-primary-700 lg:px-10 lg:py-4 lg:text-xl"
          >
            Get started free
          </Link>
        </div>

        {/* Mobile */}
        <div className="flex items-center gap-2 md:hidden">
          <Link
            href="/signup"
            className="whitespace-nowrap rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
          >
            Sign up
          </Link>
          <button
            type="button"
            className="rounded-lg p-3 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="h-8 w-8" /> : <Menu className="h-8 w-8" />}
          </button>
        </div>
        </div>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-[51] md:hidden" role="presentation">
          <button
            type="button"
            className="animate-marketing-nav-backdrop-in absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <nav
            className={clsx(
              'animate-marketing-nav-panel-in absolute left-0 right-0 top-[5.25rem] flex max-h-[calc(100dvh-5.25rem)] flex-col overflow-y-auto overscroll-contain',
              'border-b border-slate-200 bg-white px-4 py-4 shadow-lg dark:border-slate-700 dark:bg-slate-950 sm:top-[5.75rem] sm:max-h-[calc(100dvh-5.75rem)]'
            )}
            aria-label="Mobile"
          >
            <div className="flex flex-col gap-0.5">
              <Link
                href="/login"
                className="rounded-lg px-3 py-3 text-base font-semibold text-primary-600 dark:text-primary-400"
                onClick={() => setMobileOpen(false)}
              >
                Login
              </Link>
              <Link
                href="/#pricing"
                className="rounded-lg px-3 py-3 text-base font-medium text-slate-800 dark:text-slate-100"
                onClick={() => setMobileOpen(false)}
              >
                Pricing
              </Link>
              <Link
                href="/book-demo"
                className="rounded-lg px-3 py-3 text-base font-medium text-slate-800 dark:text-slate-100"
                onClick={() => setMobileOpen(false)}
              >
                Book demo
              </Link>
            </div>
            <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Solution</p>
              <MobileSolutionNav onNavigate={() => setMobileOpen(false)} />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
