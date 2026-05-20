'use client';

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { useCapabilityCheck } from '@/hooks/useCapability';
import {
  SETTINGS_HUB_SECTIONS,
  type SettingsHubSection,
  type SettingsHubColumn,
  type SettingsHubLink,
} from '@/lib/settings-hub-data';
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
  FileSpreadsheet,
  BookMarked,
  CalendarRange,
  Plug,
  CreditCard,
  HelpCircle,
} from 'lucide-react';
import { clsx } from 'clsx';

const COLUMN_ICONS: Record<string, LucideIcon> = {
  'org-core': Building2,
  users: Users,
  general: LayoutGrid,
  customization: Palette,
  'sales-billing': Palette,
  'inventory-items': LayoutGrid,
  tax: FileSpreadsheet,
  accounting: BookMarked,
  hr: CalendarRange,
  extensions: Plug,
  subscription: CreditCard,
  help: HelpCircle,
};

const ACCENT = [
  {
    linkHover:
      'hover:bg-teal-50/90 dark:hover:bg-teal-950/30 hover:text-teal-900 dark:hover:text-teal-100',
    iconWrap: 'bg-teal-100/90 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300',
    headerGradient:
      'from-teal-100/70 via-teal-50/30 to-white dark:from-teal-950/50 dark:via-slate-900/80 dark:to-slate-900',
    ring: 'ring-teal-200/60 dark:ring-teal-800/40',
  },
  {
    linkHover:
      'hover:bg-slate-100/90 dark:hover:bg-slate-800/30 hover:text-slate-900 dark:hover:text-slate-100',
    iconWrap: 'bg-slate-200/90 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
    headerGradient:
      'from-slate-100/70 via-slate-50/30 to-white dark:from-slate-900/50 dark:via-slate-900/80 dark:to-slate-900',
    ring: 'ring-slate-200/60 dark:ring-slate-800/40',
  },
  {
    linkHover:
      'hover:bg-emerald-50/90 dark:hover:bg-emerald-950/30 hover:text-emerald-900 dark:hover:text-emerald-100',
    iconWrap: 'bg-emerald-100/90 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
    headerGradient:
      'from-emerald-100/70 via-emerald-50/30 to-white dark:from-emerald-950/50 dark:via-slate-900/80 dark:to-slate-900',
    ring: 'ring-emerald-200/60 dark:ring-emerald-800/40',
  },
  {
    linkHover:
      'hover:bg-amber-50/90 dark:hover:bg-amber-950/30 hover:text-amber-900 dark:hover:text-amber-100',
    iconWrap: 'bg-amber-100/90 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
    headerGradient:
      'from-amber-100/70 via-amber-50/30 to-white dark:from-amber-950/50 dark:via-slate-900/80 dark:to-slate-900',
    ring: 'ring-amber-200/60 dark:ring-amber-800/40',
  },
  {
    linkHover:
      'hover:bg-sky-50/90 dark:hover:bg-sky-950/30 hover:text-sky-900 dark:hover:text-sky-100',
    iconWrap: 'bg-sky-100/90 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
    headerGradient:
      'from-sky-100/70 via-sky-50/30 to-white dark:from-sky-950/50 dark:via-slate-900/80 dark:to-slate-900',
    ring: 'ring-sky-200/60 dark:ring-sky-800/40',
  },
  {
    linkHover:
      'hover:bg-violet-50/90 dark:hover:bg-violet-950/30 hover:text-violet-900 dark:hover:text-violet-100',
    iconWrap: 'bg-violet-100/90 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
    headerGradient:
      'from-violet-100/70 via-violet-50/30 to-white dark:from-violet-950/50 dark:via-slate-900/80 dark:to-slate-900',
    ring: 'ring-violet-200/60 dark:ring-violet-800/40',
  },
  {
    linkHover:
      'hover:bg-rose-50/90 dark:hover:bg-rose-950/30 hover:text-rose-900 dark:hover:text-rose-100',
    iconWrap: 'bg-rose-100/90 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
    headerGradient:
      'from-rose-100/70 via-rose-50/30 to-white dark:from-rose-950/50 dark:via-slate-900/80 dark:to-slate-900',
    ring: 'ring-rose-200/60 dark:ring-rose-800/40',
  },
];

function linkVisible(
  item: SettingsHubLink,
  hasCapability: (resource: string, action?: string) => boolean,
  warehousesEnabled: boolean
): boolean {
  if (!item.module) return true;
  if (item.module === 'warehouses' && warehousesEnabled) return true;
  if (item.isLocked || (item.featureKey && !hasCapability(item.featureKey, 'view'))) {
    return true;
  }
  return hasCapability(item.module, 'view');
}

function linkMatches(l: SettingsHubLink, col: SettingsHubColumn, ql: string): boolean {
  if (ql === '') return true;
  const label = l.label.toLowerCase();
  const href = l.href.toLowerCase();
  const colTitle = col.title.toLowerCase();
  if (label.includes(ql) || href.includes(ql) || colTitle.includes(ql)) return true;
  for (const kw of l.searchKeywords ?? []) {
    const k = kw.toLowerCase();
    if (k.includes(ql) || ql.includes(k)) return true;
  }
  return false;
}

function filterColumn(
  col: SettingsHubColumn,
  hasCapability: (r: string, a?: string) => boolean,
  warehousesEnabled: boolean,
  q: string,
  sectionBroadMatch: boolean
): SettingsHubColumn | null {
  const links = col.links.filter((l) => linkVisible(l, hasCapability, warehousesEnabled));
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
  hasCapability: (r: string, a?: string) => boolean,
  warehousesEnabled: boolean,
  q: string
): SettingsHubSection | null {
  const ql = q.trim().toLowerCase();
  const sectionBroadMatch =
    ql !== '' &&
    (section.title.toLowerCase().includes(ql) ||
      section.description.toLowerCase().includes(ql));
  const cols = section.columns
    .map((c) => filterColumn(c, hasCapability, warehousesEnabled, q, sectionBroadMatch))
    .filter((c): c is SettingsHubColumn => c !== null);
  if (cols.length === 0) return null;
  return { ...section, columns: cols };
}

export function SettingsHub() {
  const router = useRouter();
  const { business } = useAuth();
  const { warehousesEnabled } = useLayoutData();
  const { hasCapability } = useCapabilityCheck();
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return SETTINGS_HUB_SECTIONS.map((s) => filterSection(s, hasCapability, warehousesEnabled, q)).filter(
      (s): s is SettingsHubSection => s !== null
    );
  }, [search, hasCapability, warehousesEnabled]);

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

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
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
      router.push('/dashboard');
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [router]);

  const businessName = business?.name?.trim() || 'Your business';

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-slate-100/95 text-text-primary backdrop-blur-[2px] dark:bg-slate-950/95"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-hub-title"
    >
      {/* Sticky header — search + close */}
      <header className="z-10 flex-shrink-0 border-b border-border/80 bg-surface/95 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-surface/85">
        <div className={`mx-auto flex ${WIDE_PAGE_CONTENT_CLASS} flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-6`}>
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={clsx(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                'bg-slate-800 text-white shadow-md shadow-slate-900/20 dark:bg-slate-700'
              )}
              aria-hidden
            >
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 id="settings-hub-title" className="text-xl font-bold tracking-tight sm:text-2xl">
                All settings
              </h1>
              <p className="truncate text-sm text-text-secondary">{businessName}</p>
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
                className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-4 text-sm text-text-primary shadow-sm placeholder:text-text-muted focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                aria-label="Search settings"
              />
            </div>
            <Link
              href="/dashboard"
              className={clsx(
                'inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium shadow-sm',
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
        <div className={`mx-auto ${WIDE_PAGE_CONTENT_CLASS} space-y-10 px-4 py-8 sm:px-6`}>
          {filtered.length === 0 && (
            <div className="rounded-2xl border border-border bg-surface p-10 text-center shadow-sm">
              <Search className="mx-auto mb-3 h-10 w-10 text-text-muted" />
              <p className="text-sm text-text-secondary">
                No settings match &ldquo;{search}&rdquo;. Try another word or{' '}
                <button
                  type="button"
                  className="font-medium text-primary-600 hover:underline"
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
              <div className="px-0.5">
                <h2 id={`hub-${section.id}`} className="text-lg font-semibold text-text-primary">
                  {section.title}
                </h2>
                <p className="mt-0.5 text-sm text-text-secondary">{section.description}</p>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {section.columns.map((col) => {
                  const accent = ACCENT[col.accentIndex % ACCENT.length];
                  const Icon = COLUMN_ICONS[col.id] ?? SlidersHorizontal;
                  return (
                    <div
                      key={col.id}
                      className={clsx(
                        'flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/90 bg-surface shadow-sm ring-1',
                        accent.ring
                      )}
                    >
                      <div
                        className={clsx(
                          'bg-gradient-to-b px-4 pb-3 pt-4',
                          accent.headerGradient
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={clsx(
                              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm',
                              accent.iconWrap
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
                          const locked =
                            link.featureKey != null && !hasCapability(link.featureKey, 'view');
                          return (
                            <li key={`${link.href}-${link.label}`}>
                              <Link
                                href={link.href}
                                className={clsx(
                                  'block rounded-lg px-3 py-2 text-sm transition-colors',
                                  'text-text-secondary',
                                  accent.linkHover,
                                  locked && 'opacity-70'
                                )}
                              >
                                <span className="font-medium text-text-primary">{link.label}</span>
                                {locked && (
                                  <span className="ml-1 text-[10px] uppercase text-text-muted">
                                    Plan
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
