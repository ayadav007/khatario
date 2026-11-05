'use client';

import { useMemo, useState } from 'react';
import { MonitorSmartphone, Paintbrush, Search, Smartphone } from 'lucide-react';
import { clsx } from 'clsx';
import type { CatalogTheme, ThemeCategoryId } from '@/lib/store/engine/theme-catalog';
import { categoryCounts, filterThemes, type ThemeSort, type ThemeTab } from '@/lib/store/engine/theme-store';
import type { ThemePreset } from '@/lib/store/engine/types';
import { LaptopFrame, PhoneFrame } from './DeviceFrames';
import { ThemeCard } from './ThemeCard';
import { ThemeLivePreview } from './ThemeLivePreview';

const TABS: { id: ThemeTab; label: string }[] = [
  { id: 'all', label: 'All themes' },
  { id: 'popular', label: 'Popular' },
  { id: 'new', label: 'New' },
  { id: 'free', label: 'Free' },
  { id: 'premium', label: 'Premium' },
];

const POINTS = [
  { icon: MonitorSmartphone, title: 'Live preview', text: 'Try before you apply' },
  { icon: Smartphone, title: 'Mobile ready', text: 'Looks right on every device' },
  { icon: Paintbrush, title: 'Easy to customise', text: 'No coding needed' },
];

/**
 * The theme store: hero with the featured theme drawn live, search, categories, tabs, sorting and the theme cards.
 * On the website (khatario.com/themes) it has the marketing hero; inside the app (`inApp`, Settings → Themes → Explore
 * themes) it drops the hero, keeps search in its toolbar and links stay in the app. `popularity` carries only an order
 * (higher first), never store counts.
 */
export function ThemeStore({
  themes,
  urls,
  popularity,
  today,
  inApp = false,
}: {
  themes: CatalogTheme[];
  /** Each theme's embedded demo store address by slug: `home` at computer width, `phone` the same page. */
  urls: Record<string, { home: string; phone: string }>;
  popularity: Partial<Record<ThemePreset, number>>;
  today: string;
  inApp?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ThemeCategoryId | 'all'>('all');
  const [tab, setTab] = useState<ThemeTab>('all');
  const [sort, setSort] = useState<ThemeSort>('popular');
  const counts = useMemo(() => categoryCounts(themes), [themes]);
  const shown = useMemo(
    () => filterThemes(themes, { category, tab, query, sort, popularity, today }),
    [themes, category, tab, query, sort, popularity, today],
  );
  const featured = themes.find((t) => t.featured && urls[t.slug]);
  const search = (
    <label className="flex w-full max-w-xl items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 shadow-sm focus-within:ring-2 focus-within:ring-primary-300">
      <Search className="h-5 w-5 text-slate-400" aria-hidden />
      <span className="sr-only">Search themes</span>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search themes (grocery, fashion, jewellery…)"
        className="w-full border-0 bg-transparent p-0 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
      />
    </label>
  );

  return (
    <>
      {inApp ? null : (
      <section className="bg-[#fbf6ee]">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:px-8 lg:py-16">
          <div>
            <span className="inline-block rounded-full bg-amber-100 px-4 py-1.5 text-sm font-medium text-amber-900">Theme store</span>
            <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight text-slate-900 sm:text-5xl">
              Beautiful storefront themes for every business
            </h1>
            <p className="mt-4 max-w-xl text-lg text-slate-600">
              Professional, mobile-first themes to create your online store in minutes.
            </p>
            <div className="mt-7">{search}</div>
            <ul className="mt-8 grid gap-5 sm:grid-cols-3">
              {POINTS.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{title}</span>
                    <span className="block text-sm text-slate-600">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {featured ? (
            <div className="relative mx-auto w-full max-w-xl pb-6 lg:pr-10">
              <div className="hidden sm:block">
                <LaptopFrame>
                  <ThemeLivePreview
                    src={urls[featured.slug].home}
                    width={1440}
                    height={900}
                    interactive={false}
                    palette={featured.palette}
                    title={`${featured.name} demo store on a computer`}
                  />
                </LaptopFrame>
              </div>
              <PhoneFrame className="mx-auto w-[46%] sm:absolute sm:-bottom-2 sm:right-0 sm:w-[30%]">
                <ThemeLivePreview
                  src={urls[featured.slug].phone}
                  width={390}
                  height={780}
                  interactive={false}
                  palette={featured.palette}
                  title={`${featured.name} demo store on a phone`}
                />
              </PhoneFrame>
            </div>
          ) : null}
        </div>
      </section>
      )}

      {inApp ? <div className="mb-6">{search}</div> : null}
      <section
        className={clsx(
          'grid gap-8',
          inApp ? 'xl:grid-cols-[220px_1fr]' : 'mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:grid-cols-[220px_1fr] lg:px-8',
        )}
      >
        <nav aria-label="Theme categories">
          <h2 className="mb-3 hidden text-lg font-semibold text-slate-900 lg:block">Categories</h2>
          <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible">
            {counts.map((c) => (
              <li key={c.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setCategory(c.id)}
                  aria-pressed={category === c.id}
                  className={clsx(
                    'flex w-full items-center justify-between gap-4 whitespace-nowrap rounded-full px-4 py-2 text-sm lg:rounded-lg',
                    category === c.id
                      ? 'bg-amber-100 font-semibold text-slate-900 lg:border-l-4 lg:border-primary-600'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 lg:bg-transparent',
                  )}
                >
                  {c.label}
                  <span className="text-slate-500">{c.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Theme lists">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={clsx(
                    'rounded-full px-5 py-2 text-sm font-medium',
                    tab === t.id ? 'bg-primary-600 text-white' : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Sort by
              <select
                value={tab === 'popular' ? 'popular' : sort}
                onChange={(e) => setSort(e.target.value as ThemeSort)}
                disabled={tab === 'popular'}
                className="rounded-full border-slate-300 py-2 pl-4 pr-9 text-sm text-slate-900"
              >
                <option value="popular">Popular</option>
                <option value="newest">Newest</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>

          {shown.length ? (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((t) => (
                <ThemeCard key={t.slug} theme={t} src={urls[t.slug]?.home ?? null} inApp={inApp} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-14 text-center">
              <p className="text-base font-medium text-slate-900">
                {query.trim() ? `No themes match “${query.trim()}”` : 'No themes in this list yet'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory('all');
                  setTab('all');
                }}
                className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                {query.trim() ? 'Clear search' : 'Show all themes'}
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
