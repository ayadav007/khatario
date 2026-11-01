import Link from 'next/link';
import { Eye } from 'lucide-react';
import type { CatalogTheme } from '@/lib/store/engine/theme-catalog';
import { themeStorePaths } from '@/lib/store/engine/theme-store';
import { ApplyThemeLink } from './ApplyThemeLink';
import { ThemeLivePreview } from './ThemeLivePreview';

export function ThemeBadge({ premium }: { premium: boolean }) {
  return premium ? (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">Premium</span>
  ) : (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">Free</span>
  );
}

export function PaletteDots({ palette }: { palette: [string, string, string] }) {
  return (
    <span className="flex gap-1.5" aria-label="Theme colours">
      {palette.map((c) => (
        <span key={c} className="h-5 w-5 rounded-full ring-1 ring-black/10" style={{ background: c }} />
      ))}
    </span>
  );
}

/** Blank has no demo store: a plain sketch of an empty page instead. */
export function BlankSketch() {
  return (
    <div className="flex aspect-[1440/900] w-full flex-col gap-3 bg-[#fbf8f3] p-5" aria-hidden>
      <div className="h-[9%] rounded bg-slate-200" />
      <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500">
        Your sections go here
      </div>
      <div className="h-[9%] rounded bg-slate-200" />
    </div>
  );
}

/** One theme in the store: live preview, name, badge, one line, palette, Details and Apply theme. */
export function ThemeCard({ theme, src, inApp = false }: { theme: CatalogTheme; src: string | null; inApp?: boolean }) {
  const blank = !theme.demo;
  const detail = themeStorePaths(inApp).detail(theme.slug);
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      <div className="relative border-b border-slate-100">
        {src ? (
          <ThemeLivePreview src={src} width={1440} height={900} interactive={false} palette={theme.palette} title={`${theme.name} demo store`} />
        ) : (
          <BlankSketch />
        )}
        {!blank ? (
          <Link
            href={detail}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900/80 px-4 py-2 text-sm font-medium text-white backdrop-blur hover:bg-slate-900"
          >
            <Eye className="h-4 w-4" aria-hidden />
            Live preview
          </Link>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-slate-900">{blank ? 'Start from blank' : theme.name}</h3>
          <ThemeBadge premium={theme.premium} />
        </div>
        <p className="text-sm text-slate-600">{theme.summary}</p>
        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          <PaletteDots palette={theme.palette} />
          <div className="flex gap-2">
            {!blank ? (
              <Link
                href={detail}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Details
              </Link>
            ) : null}
            <ApplyThemeLink slug={theme.slug} inApp={inApp} className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700">
              Apply theme
            </ApplyThemeLink>
          </div>
        </div>
      </div>
    </article>
  );
}
