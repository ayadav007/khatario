'use client';

import { Loader2 } from 'lucide-react';

/** Phone frame around the real storefront, loaded with a draft token so unsaved changes show. */
export function StoreLivePreview({
  iframeSrc = null,
  updating = false,
}: {
  storeName?: string;
  tagline?: string;
  heroUrl?: string;
  theme?: unknown;
  categories?: Array<{ id: string; name: string }>;
  iframeSrc?: string | null;
  updating?: boolean;
}) {
  return (
    <div className="mx-auto w-[412px] max-w-full">
      <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-wide text-gray-400">
        S20 Ultra preview
      </p>
      <div className="relative overflow-hidden rounded-[2.6rem] border-[12px] border-gray-900 bg-black shadow-xl">
        <div className="flex h-7 items-center justify-center bg-black">
          <span className="h-3.5 w-[5.5rem] rounded-full bg-zinc-800" />
        </div>
        {iframeSrc ? (
          <iframe
            key={iframeSrc}
            title="Store live preview"
            src={iframeSrc}
            className="h-[min(780px,calc(100vh-11rem))] w-full border-0 bg-white"
          />
        ) : (
          <div className="flex h-[min(780px,calc(100vh-11rem))] flex-col items-center justify-center gap-2 bg-white px-8 text-center text-xs text-gray-500">
            {updating ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" /> : null}
            {updating ? 'Loading your store…' : 'Set your store URL under Store setup to see a live preview here.'}
          </div>
        )}
        {iframeSrc && updating ? (
          <div className="absolute inset-0 top-7 flex items-center justify-center bg-white/70 text-xs font-medium text-gray-600">
            Updating preview…
          </div>
        ) : null}
      </div>
    </div>
  );
}
