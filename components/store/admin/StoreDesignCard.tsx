'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, Palette, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * M6: the Store editor's Appearance tab. Logo, banners, sections, collections, fonts and links are edited in the
 * store design editor; this card names the live design and opens the editor or the theme library. A store still on
 * the classic design gets the switch instead.
 */
export function StoreDesignCard({
  storeEngine,
  storeHref,
  opening,
  switching,
  onEdit,
  onSwitch,
}: {
  storeEngine: boolean;
  /** The live store's address, or null before a store URL is set. */
  storeHref: string | null;
  opening: boolean;
  switching: boolean;
  onEdit: () => void;
  onSwitch: () => void;
}) {
  const [liveName, setLiveName] = useState<string | null>(null);

  useEffect(() => {
    if (!storeEngine) return;
    let cancelled = false;
    fetch('/api/settings/online-store/themes', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const live = Array.isArray(data?.themes) ? data.themes.find((t: { role?: string }) => t.role === 'live') : null;
        if (!cancelled && live && typeof live.name === 'string') setLiveName(live.name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [storeEngine]);

  if (!storeEngine) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <p className="text-xs uppercase tracking-wide text-amber-700">Classic design</p>
        <p className="mt-1 font-semibold text-gray-900">Move your store to the new store design</p>
        <p className="mt-1 text-sm text-gray-600">
          Your logo, banners, sections and fonts are copied into the new design, and from then on you edit everything in
          the store design editor: sections you can drag, every page, themes and version history.
        </p>
        <Button type="button" className="mt-4" onClick={onSwitch} disabled={switching}>
          {switching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Switch to the new design'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex h-20 w-28 items-center justify-center rounded-lg border bg-gray-50">
        <Palette className="h-8 w-8 text-gray-400" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-gray-400">Live design</p>
        <p className="font-semibold text-gray-900">{liveName ?? 'Your store design'}</p>
        <p className="text-xs text-gray-500">
          Logo, favicon, banners, sections, collections, fonts, colours and social links are all edited in the store
          design editor. Changes save there until you publish.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {storeHref ? (
          <a
            href={storeHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            View store <ExternalLink className="ml-1 h-3.5 w-3.5" />
          </a>
        ) : null}
        <Link
          href="/settings/online-store/themes"
          className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Themes
        </Link>
        <button
          type="button"
          onClick={onEdit}
          disabled={opening}
          className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
        >
          {opening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Edit store design
        </button>
      </div>
    </div>
  );
}
