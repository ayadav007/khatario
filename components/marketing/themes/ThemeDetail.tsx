'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, ExternalLink, Monitor, Smartphone } from 'lucide-react';
import { clsx } from 'clsx';
import { THEME_CATEGORIES, type CatalogTheme } from '@/lib/store/engine/theme-catalog';
import { themeStorePaths } from '@/lib/store/engine/theme-store';
import { ApplyThemeLink } from './ApplyThemeLink';
import { PhoneFrame } from './DeviceFrames';
import { PaletteDots, ThemeBadge } from './ThemeCard';
import { ThemeLivePreview } from './ThemeLivePreview';

type Page = 'home' | 'catalog' | 'product';

const PAGES: { id: Page; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'product', label: 'Product' },
];

/**
 * One theme's page: a large live preview of its demo store with Computer / Phone and Home / Catalog / Product
 * switches (the preview scrolls; links inside do nothing), and a side panel with Apply theme and the details.
 */
export function ThemeDetail({
  theme,
  urls,
  open,
  inApp = false,
}: {
  theme: CatalogTheme;
  urls: Record<Page, string>;
  open: string;
  /** Inside the app (Settings → Themes → Explore themes): links stay in the app. */
  inApp?: boolean;
}) {
  const [device, setDevice] = useState<'computer' | 'phone'>('computer');
  const [page, setPage] = useState<Page>('home');
  const toggle = (on: boolean) =>
    clsx('inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium', on ? 'bg-primary-600 text-white' : 'text-slate-700 hover:bg-slate-100');
  const good = theme.categories.map((c) => THEME_CATEGORIES.find((x) => x.id === c)?.label).filter(Boolean);

  return (
    <div className={inApp ? '' : 'mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8'}>
      <nav className="mb-4 text-sm text-slate-500" aria-label="Breadcrumb">
        <Link href={themeStorePaths(inApp).store} className="hover:text-slate-800">
          Themes
        </Link>{' '}
        / <span className="text-slate-800">{theme.name}</span>
      </nav>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {/* Inside the app the settings frame already shows the name. */}
        {inApp ? null : <h1 className="text-3xl font-bold tracking-tight text-slate-900">{theme.name}</h1>}
        <ThemeBadge premium={theme.premium} />
      </div>
      <p className="-mt-3 mb-6 max-w-3xl text-slate-600">{theme.summary}</p>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1" role="group" aria-label="Device">
              <button type="button" className={toggle(device === 'computer')} aria-pressed={device === 'computer'} onClick={() => setDevice('computer')}>
                <Monitor className="h-4 w-4" aria-hidden />
                Computer
              </button>
              <button type="button" className={toggle(device === 'phone')} aria-pressed={device === 'phone'} onClick={() => setDevice('phone')}>
                <Smartphone className="h-4 w-4" aria-hidden />
                Phone
              </button>
            </div>
            <div className="flex gap-1" role="group" aria-label="Page">
              {PAGES.map((p) => (
                <button key={p.id} type="button" className={toggle(page === p.id)} aria-pressed={page === p.id} onClick={() => setPage(p.id)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {device === 'computer' ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
              <ThemeLivePreview src={urls[page]} width={1440} height={900} interactive palette={theme.palette} title={`${theme.name} demo store`} />
            </div>
          ) : (
            <PhoneFrame className="mx-auto w-full max-w-[360px]">
              <ThemeLivePreview src={urls[page]} width={390} height={780} interactive palette={theme.palette} title={`${theme.name} demo store on a phone`} />
            </PhoneFrame>
          )}
          <p className="mt-3 text-sm text-slate-500">Sample products from a demo store. Your own products appear when you apply the theme.</p>
        </div>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-28 lg:self-start">
          <ApplyThemeLink
            slug={theme.slug}
            inApp={inApp}
            className="block rounded-xl bg-primary-600 px-5 py-3 text-center text-base font-semibold text-white hover:bg-primary-700"
          >
            Apply theme
          </ApplyThemeLink>
          <p className="text-sm leading-relaxed text-slate-700">{theme.about}</p>
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Good for</h2>
            <p className="text-sm text-slate-700">{good.join(', ')}</p>
          </div>
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Features</h2>
            <ul className="space-y-1.5 text-sm text-slate-700">
              {theme.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Colours</h2>
            <PaletteDots palette={theme.palette} />
          </div>
          <a href={open} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline">
            Open demo store
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </aside>
      </div>
    </div>
  );
}
