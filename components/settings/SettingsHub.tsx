'use client';

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData, useShellLayoutSettings } from '@/contexts/LayoutDataContext';
import { isSettingsLinkLocked } from '@/lib/settings-link-lock';
import { useCapabilityCheck } from '@/hooks/useCapability';
import {
  buildSettingsHubSections,
  type SettingsHubSection,
  type SettingsHubColumn,
  type SettingsHubLink,
} from '@/lib/settings-hub-data';
import type { PlatformModule } from '@/lib/platform-modules';
import { WIDE_PAGE_CONTENT_CLASS } from '@/lib/page-layout';
import type { LucideIcon } from 'lucide-react';
import {
  Search,
  X,
  SlidersHorizontal,
  Building2,
  Users,
  LayoutGrid,
  Palette,
  FileText,
  BookMarked,
  CalendarRange,
  Plug,
  CreditCard,
  HelpCircle,
  MessageSquare,
  ShoppingBag,
  Clock,
  UserCheck,
} from 'lucide-react';
import { clsx } from 'clsx';
import { MobileListRow, MobileListSection } from '@/components/layout/MobileList';

const COLUMN_ICONS: Record<string, LucideIcon> = {
  account: Building2,
  team: Users,
  plan: CreditCard,
  'billing-setup': Building2,
  accounting: BookMarked,
  'sales-billing': FileText,
  'online-store': ShoppingBag,
  'inventory-items': LayoutGrid,
  'billing-general': SlidersHorizontal,
  'hr-organization': Building2,
  'hr-time-attendance': Clock,
  'hr-leave': CalendarRange,
  'hr-payroll': CreditCard,
  'hr-hiring': UserCheck,
  'hr-employee-portal': Users,
  whatsapp: MessageSquare,
  integrations: Plug,
  system: Palette,
  help: HelpCircle,
};

const COLUMN_LINK_HOVER =
  'hover:bg-slate-50 dark:hover:bg-slate-800/80 hover:text-text-primary';
const COLUMN_ICON_WRAP =
  'bg-slate-100 text-text-secondary dark:bg-slate-800 dark:text-slate-300';
const COLUMN_HEADER = 'border-b border-border bg-surface px-4 pb-3 pt-4';

type CapabilityCheck = (resource: string, action?: string) => { allowed: boolean; denialReason?: string };

/** Same role rule as the desktop sidebar: the role must allow view; a plan-only denial still shows the link. */
function linkVisible(item: SettingsHubLink, checkCapability: CapabilityCheck): boolean {
  if (!item.module) return true;
  const result = checkCapability(item.module, 'view');
  return result.allowed || result.denialReason === 'FEATURE_NOT_IN_PLAN';
}

function linkMatches(l: SettingsHubLink, col: SettingsHubColumn, ql: string): boolean {
  if (ql === '') return true;
  const label = l.label.toLowerCase();
  const href = l.href.toLowerCase();
  const colTitle = col.title.toLowerCase();
  if (label.includes(ql) || href.includes(ql) || colTitle.includes(ql)) return true;
  // A keyword may sit inside a longer query, but only as a whole word ("ess" must not match "address").
  const words = ql.split(/[^a-z0-9]+/).filter(Boolean);
  for (const kw of l.searchKeywords ?? []) {
    const k = kw.toLowerCase();
    if (k.includes(ql) || words.includes(k)) return true;
  }
  return false;
}

function filterColumn(
  col: SettingsHubColumn,
  checkCapability: CapabilityCheck,
  q: string,
  sectionBroadMatch: boolean
): SettingsHubColumn | null {
  const links = col.links.filter((l) => linkVisible(l, checkCapability));
  const ql = q.trim().toLowerCase();
  const filtered =
    ql === ''
      ? links
      : sectionBroadMatch
        ? links
        : links.filter((l) => linkMatches(l, col, ql));
  if (filtered.length === 0) return null;
  return { ...col, links: filtered };
}

function filterSection(
  section: SettingsHubSection,
  checkCapability: CapabilityCheck,
  q: string
): SettingsHubSection | null {
  const ql = q.trim().toLowerCase();
  const sectionBroadMatch =
    ql !== '' &&
    (section.title.toLowerCase().includes(ql) ||
      section.description.toLowerCase().includes(ql));
  const cols = section.columns
    .map((c) => filterColumn(c, checkCapability, q, sectionBroadMatch))
    .filter((c): c is SettingsHubColumn => c !== null);
  if (cols.length === 0) return null;
  return { ...section, columns: cols };
}

export function SettingsHub() {
  const router = useRouter();
  const { business, platformSession } = useAuth();
  const { supplierHubVisible } = useLayoutData();
  const { snapshotLoaded } = useShellLayoutSettings();
  const { hasCapability, checkCapability } = useCapabilityCheck();
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const homeHref = platformSession?.defaultHomePath ?? '/dashboard';
  // Never show a lock while the plan snapshot is still loading.
  const isLocked = (link: SettingsHubLink) => snapshotLoaded && isSettingsLinkLocked(link, hasCapability);

  const enabledModules = platformSession?.enabledModules ?? (['billing'] as PlatformModule[]);

  const hubSections = useMemo(
    () =>
      buildSettingsHubSections(enabledModules, {
        hasFeature: (featureKey) => hasCapability(featureKey, 'view'),
        supplierHubVisible: supplierHubVisible === true,
      }),
    [enabledModules, hasCapability, supplierHubVisible],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return hubSections
      .map((s) => filterSection(s, checkCapability, q))
      .filter((s): s is SettingsHubSection => s !== null);
  }, [search, checkCapability, hubSections]);

  const onSearchKey = useCallback((e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      searchRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', onSearchKey);
    return () => window.removeEventListener('keydown', onSearchKey);
  }, [onSearchKey]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Desktop: start in the search box. Phones skip this so the keyboard does not cover the list.
  useEffect(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) searchRef.current?.focus();
  }, []);

  // Keep Tab inside the hub while it covers the page.
  useEffect(() => {
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !rootRef.current) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]:not(#settings-hub)')) return;
      const focusable = Array.from(
        rootRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!rootRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onTab);
    return () => document.removeEventListener('keydown', onTab);
  }, []);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Another dialog (command palette, upgrade modal) is open on top: let it close first.
      if (document.querySelector('[role="dialog"][aria-modal="true"]:not(#settings-hub)')) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') {
        const input = t as HTMLInputElement;
        if (input.value) {
          e.preventDefault();
          setSearch('');
          input.blur();
          return;
        }
      }
      router.push(homeHref);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [router, homeHref]);

  const businessName = business?.name?.trim() || 'Your business';

  return (
    <div
      id="settings-hub"
      ref={rootRef}
      className="fixed inset-0 z-[100] flex flex-col bg-slate-100/95 text-text-primary backdrop-blur-[2px] dark:bg-slate-950/95"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-hub-title"
    >
      {/* Sticky header — search + close */}
      <header className="z-10 flex-shrink-0 border-b border-border/80 bg-surface/95 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-surface/85">
        <div className={`mx-auto flex ${WIDE_PAGE_CONTENT_CLASS} max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-6`}>
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={clsx(
                'hidden md:flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                'bg-slate-800 text-white shadow-md shadow-slate-900/20 dark:bg-slate-700'
              )}
              aria-hidden
            >
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 id="settings-hub-title" className="settings-page-title sr-only md:not-sr-only">
                All settings
              </h1>
              <p className="type-body-secondary truncate">{businessName}</p>
            </div>
          </div>

          <div className="flex w-full flex-1 flex-col items-stretch gap-3 sm:flex-row sm:items-center lg:max-w-3xl lg:justify-end">
            <div className="relative min-w-0 flex-1 max-w-xl lg:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search settings (press /)"
                className="min-h-11 w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-4 text-base text-text-primary sm:text-sm shadow-sm placeholder:text-text-muted focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                aria-label="Search settings"
              />
            </div>
            <Link
              href={homeHref}
              className={clsx(
                'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium shadow-sm',
                'whitespace-nowrap transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/80'
              )}
            >
              <X className="h-4 w-4 text-text-muted" aria-hidden />
              Close
            </Link>
          </div>
        </div>
      </header>

      {/* Scrollable hub */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className={`mx-auto ${WIDE_PAGE_CONTENT_CLASS} max-w-7xl space-y-10 px-4 py-8 sm:px-6`}>
          {filtered.length === 0 && (
            <div className="rounded-2xl border border-border bg-surface p-10 text-center shadow-sm">
              <Search className="mx-auto mb-3 h-10 w-10 text-text-muted" />
              <p className="text-sm text-text-secondary">
                No settings match &ldquo;{search}&rdquo;. Try another word or{' '}
                <button
                  type="button"
                  className="font-medium text-primary-600 hover:underline dark:text-primary-200"
                  onClick={() => setSearch('')}
                >
                  clear search
                </button>
                .
              </p>
            </div>
          )}

          {filtered.map((section) => (
            <section key={section.id} className="space-y-5" aria-labelledby={`hub-${section.id}`}>
              <div className="hidden px-0.5 lg:block">
                <h2 id={`hub-${section.id}`} className="settings-section-title mb-0">
                  {section.title}
                </h2>
                <p className="type-body-secondary mt-0.5">{section.description}</p>
              </div>

              <div className="-mx-4 lg:hidden">
                {section.columns.map((col) => {
                  const Icon = COLUMN_ICONS[col.id] ?? SlidersHorizontal;
                  return (
                    <MobileListSection key={col.id} title={col.title}>
                      {col.links.map((link) => {
                        const locked = isLocked(link);
                        return (
                          <MobileListRow
                            key={`${link.href}-${link.label}`}
                            href={link.href}
                            label={link.label}
                            icon={Icon}
                            locked={locked}
                          />
                        );
                      })}
                    </MobileListSection>
                  );
                })}
              </div>

              <div className="hidden gap-5 lg:grid lg:grid-cols-3">
                {section.columns.map((col) => {
                  const Icon = COLUMN_ICONS[col.id] ?? SlidersHorizontal;
                  return (
                    <div
                      key={col.id}
                      className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
                    >
                      <div className={COLUMN_HEADER}>
                        <div className="flex items-center gap-3">
                          <div
                            className={clsx(
                              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                              COLUMN_ICON_WRAP
                            )}
                            aria-hidden
                          >
                            <Icon className="h-5 w-5" strokeWidth={2} />
                          </div>
                          <h3 className="min-w-0 text-sm font-semibold leading-snug text-text-primary">
                            {col.title}
                          </h3>
                        </div>
                      </div>

                      <ul className="space-y-0.5 px-2 pb-3 pt-1">
                        {col.links.map((link) => {
                          const locked = isLocked(link);
                          return (
                            <li key={`${link.href}-${link.label}`}>
                              <Link
                                href={link.href}
                                className={clsx(
                                  'block rounded-lg px-3 py-2 text-sm transition-colors',
                                  'text-text-secondary',
                                  COLUMN_LINK_HOVER,
                                  locked && 'opacity-70'
                                )}
                              >
                                <span className="font-medium text-text-primary">{link.label}</span>
                                {locked && (
                                  <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-2xs font-semibold uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                    Upgrade
                                  </span>
                                )}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          <p className="pb-6 text-center text-xs text-text-muted">
            Open any item to work in full screen — the menu switches to settings navigation.
          </p>
        </div>
      </div>
    </div>
  );
}
