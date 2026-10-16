'use client';

import { useEffect, useState } from 'react';
import { Minus, Monitor, Plus } from 'lucide-react';
import { DESKTOP_ZOOM, getDesktopZoom, isKhatarioDesktop, nextDesktopZoom, setDesktopZoom } from '@/lib/desktop/platform';

/**
 * "Screen size" for Khatario for Windows (like Vyapar's Screen Zoom/Scale), shown in the profile menu.
 * Renders nothing in a browser.
 */
export function DesktopScreenSize() {
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => {
    if (!isKhatarioDesktop()) return;
    getDesktopZoom()
      .then((value) => setZoom(value ?? DESKTOP_ZOOM.default))
      .catch(() => setZoom(null));
  }, []);

  if (zoom === null) return null;

  const apply = async (value: number) => {
    const applied = await setDesktopZoom(value).catch(() => null);
    if (applied !== null) setZoom(applied);
  };
  const percent = Math.round(zoom * 100);

  return (
    <div className="border-b border-border px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Monitor className="h-4 w-4 text-text-muted" aria-hidden />
          Screen size
        </span>
        <span className="text-sm tabular-nums text-text-secondary">{percent}%</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => apply(nextDesktopZoom(zoom, 'out'))}
          disabled={zoom <= DESKTOP_ZOOM.min}
          className="rounded-md border border-border p-1 text-text-secondary hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
          aria-label="Smaller"
        >
          <Minus className="h-4 w-4" />
        </button>
        <input
          type="range"
          min={DESKTOP_ZOOM.min * 100}
          max={DESKTOP_ZOOM.max * 100}
          step={5}
          value={percent}
          onChange={(e) => setZoom(Number(e.target.value) / 100)}
          onPointerUp={(e) => apply(Number((e.target as HTMLInputElement).value) / 100)}
          onKeyUp={(e) => apply(Number((e.target as HTMLInputElement).value) / 100)}
          className="flex-1 accent-primary-600"
          aria-label="Screen size"
        />
        <button
          type="button"
          onClick={() => apply(nextDesktopZoom(zoom, 'in'))}
          disabled={zoom >= DESKTOP_ZOOM.max}
          className="rounded-md border border-border p-1 text-text-secondary hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
          aria-label="Larger"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1.5 text-xs text-text-muted">Ctrl + and Ctrl − also work. Ctrl 0 resets to 80%.</p>
    </div>
  );
}
