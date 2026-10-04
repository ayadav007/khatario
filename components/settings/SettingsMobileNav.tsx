'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCapabilityCheck } from '@/hooks/useCapability';
import { buildFlatSettingsGroups } from '@/lib/settings-module-registry';
import type { PlatformModule } from '@/lib/platform-modules';

type Props = {
  open: boolean;
  onClose: () => void;
};

function linkMatches(label: string, href: string, keywords: string[] | undefined, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (label.toLowerCase().includes(q) || href.toLowerCase().includes(q)) return true;
  return (keywords ?? []).some((word) => word.toLowerCase().includes(q) || q.includes(word.toLowerCase()));
}

/** Same settings groups as the desktop sidebar, as a searchable sheet on small screens. */
export function SettingsMobileNav({ open, onClose }: Props) {
  const pathname = usePathname() ?? '';
  const { platformSession } = useAuth();
  const { hasCapability } = useCapabilityCheck();
  const [search, setSearch] = useState('');
  const [locationHash, setLocationHash] = useState('');

  useEffect(() => {
    if (!open) return;
    const read = () => setLocationHash(window.location.hash.replace(/^#/, ''));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [open, pathname]);

  const enabledModules = platformSession?.enabledModules ?? (['billing'] as PlatformModule[]);

  const groups = useMemo(
    () =>
      buildFlatSettingsGroups(enabledModules, {
        hasFeature: (featureKey) => hasCapability(featureKey, 'view'),
      }),
    [enabledModules, hasCapability],
  );

  const hrefs = useMemo(() => groups.flatMap((group) => group.links.map((link) => link.href)), [groups]);

  const isActive = (href: string) => {
    const hashIdx = href.indexOf('#');
    const linkHash = hashIdx >= 0 ? href.slice(hashIdx + 1) : '';
    const path = (hashIdx >= 0 ? href.slice(0, hashIdx) : href).split('?')[0];
    const pathMatch = pathname === path || pathname.startsWith(`${path}/`);
    if (!pathMatch) return false;
    if (linkHash) return pathname === path && locationHash === linkHash;
    if (
      pathname === path &&
      locationHash &&
      hrefs.some((other) => {
        const otherHashIdx = other.indexOf('#');
        if (otherHashIdx < 0) return false;
        const otherPath = other.slice(0, otherHashIdx).split('?')[0];
        return otherPath === path && other.slice(otherHashIdx + 1) === locationHash;
      })
    ) {
      return false;
    }
    if (pathname !== path) {
      const longer = hrefs.some((other) => {
        const otherPath = other.split('#')[0].split('?')[0];
        if (otherPath.length <= path.length) return false;
        return pathname === otherPath || pathname.startsWith(`${otherPath}/`);
      });
      if (longer) return false;
    }
    return true;
  };

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
        onClick={onClose}
      />
      <div className="fixed inset-x-0 bottom-0 z-[10071] flex max-h-[80vh] flex-col rounded-t-2xl border border-border bg-background shadow-[0_-8px_30px_rgba(0,0,0,0.15)] lg:hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-text-primary">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-text-secondary hover:bg-gray-100 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="border-b border-border px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search settings"
              className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm"
              aria-label="Search settings"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-text-secondary">No settings match.</p>
          ) : (
            filtered.map((group) => (
              <section key={group.groupId} className="mb-3">
                <h3 className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {group.title}
                </h3>
                <ul>
                  {group.links.map((link) => {
                    const active = isActive(link.href);
                    return (
                      <li key={`${group.groupId}-${link.href}-${link.label}`}>
                        <Link
                          href={link.href}
                          onClick={onClose}
                          className={`block rounded-lg px-3 py-2.5 text-sm ${
                            active
                              ? 'bg-slate-100 font-medium text-text-primary dark:bg-slate-800'
                              : 'text-text-secondary hover:bg-slate-50 dark:hover:bg-slate-800/60'
                          }`}
                        >
                          {link.label}
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
            className="mt-1 block rounded-lg px-3 py-3 text-sm font-medium text-primary-700 hover:bg-slate-50 dark:text-primary-300"
          >
            All settings
          </Link>
        </div>
      </div>
    </>
  );
}
