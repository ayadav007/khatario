'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { HowToSectionBlocks } from './HowToSectionBlocks';
import type { HowToArticle } from '@/lib/help/how-to-articles';
import { HOW_TO_CATEGORIES, getAllHowToArticles, getFeaturedHowToArticles } from '@/lib/help/how-to-articles';
import { HowToFeaturedTiles } from './HowToFeaturedTiles';
import {
  BarChart3,
  BookOpen,
  ChevronDown,
  FileText,
  Landmark,
  Package,
  Rocket,
  Search,
  UserCog,
} from 'lucide-react';
import { clsx } from 'clsx';

type Props = {
  className?: string;
};

const CATEGORY_COPY: Record<
  string,
  { blurb: string; icon: typeof Rocket }
> = {
  'Getting started': {
    blurb: 'Set up your company, year, and team so everything else works smoothly.',
    icon: Rocket,
  },
  'Sales & customers': {
    blurb: 'Quotation to invoice, customers, and sales-related documents.',
    icon: FileText,
  },
  'Purchases, stock & items': {
    blurb: 'Suppliers, purchase bills, items, and stock in one place.',
    icon: Package,
  },
  'Money & books': {
    blurb: 'Ledgers, payments, expenses, and how they show in your accounts.',
    icon: Landmark,
  },
  'Reports & GST': {
    blurb: 'Financial reports, aging, and GST return views in the app.',
    icon: BarChart3,
  },
  'Team, settings & add-ons': {
    blurb: 'HR, integration tools, search, and where to get more help.',
    icon: UserCog,
  },
};

function GuideIcon({ article }: { article: HowToArticle }) {
  const Cat = CATEGORY_COPY[article.category]?.icon ?? BookOpen;
  return (
    <span
      className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 ring-1 ring-slate-200/80 dark:bg-slate-800/80 dark:text-slate-300 dark:ring-slate-700"
      aria-hidden
    >
      <Cat className="h-6 w-6" strokeWidth={1.5} />
    </span>
  );
}

/**
 * Feature-guides style: neutral hero, category sections, expandable rows (inspired by public help sites; no brand-gradient hero per colors.mdc).
 */
export function HowToBlogAccordion({ className }: Props) {
  const allArticles = useMemo(() => getAllHowToArticles(), []);
  const featuredTileItems = useMemo(() => {
    return getFeaturedHowToArticles().map((article) => ({
      article,
      Icon: CATEGORY_COPY[article.category]?.icon ?? BookOpen,
    }));
  }, []);
  const [query, setQuery] = useState('');
  const [openSlug, setOpenSlug] = useState<string | null>(allArticles[0]?.slug ?? null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const filtered = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return allArticles;
    return allArticles.filter(
      (a) =>
        a.title.toLowerCase().includes(s) ||
        a.description.toLowerCase().includes(s) ||
        a.category.toLowerCase().includes(s)
    );
  }, [allArticles, query]);

  useEffect(() => {
    if (filtered.length === 0) {
      setOpenSlug(null);
      return;
    }
    if (openSlug && !filtered.some((a) => a.slug === openSlug)) {
      setOpenSlug(filtered[0].slug);
    }
  }, [filtered, openSlug]);

  const byCategory = useMemo(() => {
    const m: Record<string, HowToArticle[]> = {};
    for (const c of HOW_TO_CATEGORIES) m[c] = [];
    for (const a of filtered) {
      if (!m[a.category]) m[a.category] = [];
      m[a.category].push(a);
    }
    return m;
  }, [filtered]);

  useEffect(() => {
    const applyHash = () => {
      const h = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
      if (!h) return;
      const a = allArticles.find((x) => x.slug === h);
      if (a) {
        setOpenSlug(a.slug);
        setTimeout(() => {
          sectionRefs.current[a.slug]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, [allArticles]);

  const toggle = useCallback((slug: string) => {
    setOpenSlug((prev) => (prev === slug ? null : slug));
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${slug}`);
    }
  }, []);

  const jumpTo = useCallback((slug: string) => {
    setOpenSlug(slug);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${slug}`);
      sectionRefs.current[slug]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  return (
    <div className={clsx('mx-auto max-w-5xl', className)}>
      {/* Hero — neutral only (no primary gradient on large surface) */}
      <header className="mb-10 rounded-2xl border border-slate-200/90 bg-slate-50/90 px-6 py-10 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/40 sm:px-10 sm:py-12">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Guides</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl">
          Find the right help for your business
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 dark:text-slate-300 sm:text-lg">
          Short, practical guides for billing, accounts, and reports in Khatario — the same ideas you see on
          professional help centres, tailored to this app.
        </p>
      </header>

      <HowToFeaturedTiles items={featuredTileItems} onSelect={jumpTo} />

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="relative w-full sm:max-w-lg">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search guides by topic…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 border-slate-200 bg-white pl-10 text-base shadow-sm dark:border-slate-600 dark:bg-slate-900/60"
            aria-label="Search how-to guides"
          />
        </div>
        {filtered.length > 0 && (
          <p className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
            {filtered.length} {filtered.length === 1 ? 'article' : 'articles'}
          </p>
        )}
      </div>

      {/* Quick jump — compact, neutral active state */}
      {filtered.length > 0 && (
        <div className="mb-10 rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/30 sm:p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            On this page
          </p>
          <ul className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
            {filtered.map((a) => (
              <li key={a.slug}>
                <button
                  type="button"
                  onClick={() => jumpTo(a.slug)}
                  className={clsx(
                    'w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors sm:w-auto',
                    openSlug === a.slug
                      ? 'bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/50'
                  )}
                >
                  {a.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 py-16 text-center dark:border-slate-700 dark:bg-slate-900/20">
          <p className="text-slate-600 dark:text-slate-300">No articles match your search. Try a different keyword.</p>
        </div>
      ) : (
        <div className="space-y-12">
          {HOW_TO_CATEGORIES.map((category) => {
            const list = byCategory[category] || [];
            if (list.length === 0) return null;
            const meta = CATEGORY_COPY[category];
            const SectionIcon = meta?.icon ?? BookOpen;
            return (
              <section key={category} className="space-y-5" aria-labelledby={`cat-label-${category}`}>
                <div className="flex flex-col gap-1 border-b border-slate-200 pb-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <SectionIcon className="h-5 w-5" strokeWidth={1.75} />
                    </span>
                    <div>
                      <h2
                        id={`cat-label-${category}`}
                        className="text-lg font-bold text-slate-900 dark:text-slate-50"
                      >
                        {category}
                      </h2>
                      {meta?.blurb && (
                        <p className="mt-0.5 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                          {meta.blurb}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 self-start rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {list.length} {list.length === 1 ? 'guide' : 'guides'}
                  </span>
                </div>

                <ul className="space-y-3">
                  {list.map((article) => {
                    const isOpen = openSlug === article.slug;
                    return (
                      <li key={article.slug} className="scroll-mt-24">
                        <div
                          id={article.slug}
                          ref={(el) => {
                            sectionRefs.current[article.slug] = el;
                          }}
                        >
                        <div
                          className={clsx(
                            'overflow-hidden rounded-2xl border transition-shadow',
                            isOpen
                              ? 'border-slate-300 bg-white shadow-md ring-1 ring-slate-900/5 dark:border-slate-600 dark:bg-slate-900/50'
                              : 'border-slate-200/95 bg-white hover:border-slate-300 hover:shadow dark:border-slate-700 dark:bg-slate-900/30 dark:hover:border-slate-600'
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggle(article.slug)}
                            className="flex w-full items-start gap-4 px-4 py-4 text-left sm:gap-5 sm:px-5 sm:py-5"
                            aria-expanded={isOpen}
                            id={`${article.slug}-header`}
                            aria-controls={`${article.slug}-panel`}
                          >
                            <GuideIcon article={article} />
                            <span className="min-w-0 flex-1">
                              <span className="block text-lg font-semibold leading-snug text-slate-900 dark:text-slate-50 sm:text-[1.125rem]">
                                {article.title}
                              </span>
                              <span className="mt-1.5 block text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                                {article.description}
                              </span>
                              <time
                                className="mt-2 block text-xs text-slate-400 dark:text-slate-500"
                                dateTime={article.updatedAt}
                              >
                                Last updated {article.updatedAt}
                              </time>
                            </span>
                            <span
                              className={clsx(
                                'mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition-transform dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
                                isOpen && 'border-slate-300 bg-slate-100 dark:border-slate-500'
                              )}
                              aria-hidden
                            >
                              <ChevronDown
                                className={clsx('h-4 w-4 transition-transform', isOpen && 'rotate-180')}
                              />
                            </span>
                          </button>
                          {isOpen && (
                            <div
                              id={`${article.slug}-panel`}
                              role="region"
                              aria-labelledby={`${article.slug}-header`}
                              className="border-t border-slate-100 bg-slate-50/50 px-4 py-6 sm:px-8 sm:py-8 dark:border-slate-700/80 dark:bg-slate-950/20"
                            >
                              <div className="mx-auto max-w-3xl text-base leading-[1.75] text-slate-800 dark:text-slate-200 sm:text-[17px]">
                                <HowToSectionBlocks sections={article.sections} />
                              </div>
                            </div>
                          )}
                        </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
