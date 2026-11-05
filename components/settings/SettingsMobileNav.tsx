'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData, useShellLayoutSettings } from '@/contexts/LayoutDataContext';
import { isSettingsLinkLocked } from '@/lib/settings-link-lock';
import { useCapabilityCheck } from '@/hooks/useCapability';
import { buildFlatSettingsGroups } from '@/lib/settings-module-registry';
import { pickActiveNavHref } from '@/lib/navigation/nav-active';
import type { PlatformModule } from '@/lib/platform-modules';

type Props = {
  open: boolean;
  onClose: () => void;
};

function linkMatches(label: string, href: string, keywords: string[] | undefined, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (label.toLowerCase().includes(q) || href.toLowerCase().includes(q)) return true;
  // A keyword may sit inside a longer query ("gst" in "gst settings"), but only whole words,
  // so a short keyword like "ess" does not match "address".
  const words = q.split(/[^a-z0-9]+/).filter(Boolean);
  return (keywords ?? []).some((word) => {
    const k = word.toLowerCase();
    return k.includes(q) || words.includes(k);
  });
}

/** Same settings groups as the desktop sidebar, as a searchable sheet on small screens. */
export function SettingsMobileNav({ open, onClose }: Props) {
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const searchKey = searchParams?.toString() ?? '';
  const { platformSession } = useAuth();
  const { supplierHubVisible } = useLayoutData();
  const { snapshotLoaded } = useShellLayoutSettings();
  const { hasCapability, checkCapability } = useCapabilityCheck();
  const [search, setSearch] = useState('');
  const [locationHash, setLocationHash] = useState('');
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // The parent passes a new function each render; keep the effect below from re-running.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const read = () => setLocationHash(window.location.hash.replace(/^#/, ''));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [open, pathname]);

  // While open: Esc closes, the page behind does not scroll, focus moves in and comes back.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => {
      const sheet = sheetRef.current;
      sheet?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'center' });
      sheet?.focus();
    });
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  const enabledModules = platformSession?.enabledModules ?? (['billing'] as PlatformModule[]);

  const groups = useMemo(
    () =>
      buildFlatSettingsGroups(enabledModules, {
        hasFeature: (featureKey) => hasCapability(featureKey, 'view'),
        supplierHubVisible: supplierHubVisible === true,
      })
        // Same role rule as the desktop sidebar: a plan-only denial still shows the link.
        .map((group) => ({
          ...group,
          links: group.links.filter((link) => {
            const result = checkCapability(link.module, 'view');
            return result.allowed || result.denialReason === 'FEATURE_NOT_IN_PLAN';
          }),
        }))
        .filter((group) => group.links.length > 0),
    [enabledModules, hasCapability, checkCapability, supplierHubVisible],
  );

  const activeHref = useMemo(
    () =>
      pickActiveNavHref(
        groups.flatMap((group) => group.links.map((link) => link.href)),
        pathname,
        searchKey,
        locationHash,
      ),
    [groups, pathname, searchKey, locationHash],
  );

  const filtered = useMemo(() => {
    const q = search.trim();
    return groups
      .map((group) => ({
        ...group,
        links: group.links.filter((link) =>
          linkMatches(link.label, link.href, link.searchKeywords, q),
        ),
      }))
      .filter((group) => group.links.length > 0);
  }, [groups, search]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[10070] bg-black/40 lg:hidden"
        aria-label="Close settings menu"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 z-[10071] flex max-h-[80dvh] flex-col rounded-t-2xl border border-border bg-background pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_rgba(0,0,0,0.15)] focus:outline-none lg:hidden"
      >
        <div className="flex items-center justify-between border-b border-border py-1 pl-4 pr-1">
          <h2 id={titleId} className="text-base font-semibold text-text-primary">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-gray-100 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="border-b border-border px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            {/* 16px text: iOS zooms into smaller inputs on focus. */}
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search settings"
              className="min-h-11 w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-base text-text-primary"
              aria-label="Search settings"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-text-secondary">
              <p>No settings match.</p>
              <button
                type="button"
                onClick={() => setSearch('')}
                className="mt-2 min-h-11 rounded-lg px-3 font-medium text-primary-700 hover:bg-slate-50 dark:text-primary-200 dark:hover:bg-slate-800/60"
              >
                Clear search
              </button>
            </div>
          ) : (
            filtered.map((group) => (
              <section key={group.groupId} className="mb-3">
                <h3 className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {group.title}
                </h3>
                <ul>
                  {group.links.map((link) => {
                    const active = link.href === activeHref;
                    const locked = snapshotLoaded && isSettingsLinkLocked(link, hasCapability);
                    return (
                      <li key={`${group.groupId}-${link.href}-${link.label}`}>
                        <Link
                          href={link.href}
                          onClick={onClose}
                          aria-current={active ? 'page' : undefined}
                          className={`flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-sm ${
                            active
                              ? 'bg-slate-100 font-medium text-text-primary dark:bg-slate-800'
                              : 'text-text-secondary hover:bg-slate-50 dark:hover:bg-slate-800/60'
                          }`}
                        >
                          <span className="min-w-0 truncate">{link.label}</span>
                          {locked ? (
                            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-2xs font-semibold uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                              Upgrade
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
          <Link
            href="/settings"
            onClick={onClose}
            className="mt-1 flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-primary-700 hover:bg-slate-50 dark:text-primary-200 dark:hover:bg-slate-800/60"
          >
            All settings
          </Link>
        </div>
      </div>
    </>
  );
}
