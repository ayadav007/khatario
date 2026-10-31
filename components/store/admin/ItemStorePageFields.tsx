'use client';

import React from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { CategorySizeChartEditor } from '@/components/store/admin/CategorySizeChartEditor';
import { validateProductExtras, videoEmbed } from '@/lib/store/product-extras';
import type { SizeChart, StoreSwatch, StoreTab } from '@/lib/store/product-extras';
import { TABS_MAX, emptyChart, moveTab } from '@/lib/store/size-chart-grid';

const SWATCHES_MAX = 6;

export type ItemStorePageValue = {
  video_url: string;
  store_tabs: StoreTab[];
  size_chart: SizeChart | null;
  store_badge: string;
  store_tagline: string;
  store_swatches: StoreSwatch[];
};

interface Props {
  value: ItemStorePageValue;
  onChange: (next: ItemStorePageValue) => void;
  /** The chart set on this item's category, shown when the item uses it. */
  categoryChart: SizeChart | null;
  /** Message from the server after a failed save. */
  serverError?: string | null;
}

function youtubeThumb(src: string): string | null {
  const id = src.split('/embed/')[1];
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}

function ChartPreview({ chart }: { chart: SizeChart }) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="text-sm">
        <thead>
          <tr>
            {chart.columns.map((c, i) => (
              <th key={i} className="border border-border px-2 py-1 text-left dark:border-border-dark">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} className="border border-border px-2 py-1 dark:border-border-dark">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Store page" card for the item form: video, info tabs and size chart. */
export function ItemStorePageFields({ value, onChange, categoryChart, serverError }: Props) {
  const check = validateProductExtras({
    video_url: value.video_url,
    store_tabs: value.store_tabs,
    size_chart: value.size_chart,
    store_badge: value.store_badge,
    store_tagline: value.store_tagline,
    store_swatches: value.store_swatches,
  });
  const error = check.ok ? null : check.error;
  const embed = videoEmbed(value.video_url);
  const thumb = embed?.kind === 'youtube' ? youtubeThumb(embed.src) : null;
  const set = (patch: Partial<ItemStorePageValue>) => onChange({ ...value, ...patch });

  const setTab = (i: number, patch: Partial<StoreTab>) =>
    set({ store_tabs: value.store_tabs.map((t, ti) => (ti === i ? { ...t, ...patch } : t)) });

  const setSwatch = (i: number, patch: Partial<StoreSwatch>) =>
    set({ store_swatches: value.store_swatches.map((s, si) => (si === i ? { ...s, ...patch } : s)) });

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <span className="type-label block">Card</span>
        <div>
          <label htmlFor="store-badge" className="type-label mb-1.5 block">Badge on the photo</label>
          <input
            id="store-badge"
            className="input w-full"
            maxLength={24}
            placeholder="e.g. Bestseller"
            value={value.store_badge}
            onChange={(e) => set({ store_badge: e.target.value })}
          />
          <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
            Replaces the automatic New / % off badge. Leave empty to keep those.
          </p>
        </div>
        <div>
          <label htmlFor="store-tagline" className="type-label mb-1.5 block">Tagline above the name</label>
          <input
            id="store-tagline"
            className="input w-full"
            maxLength={60}
            placeholder="e.g. Hand-block printed cotton"
            value={value.store_tagline}
            onChange={(e) => set({ store_tagline: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="type-label">Colour swatches</span>
            <span className="text-xs text-text-secondary dark:text-text-secondary-dark">
              {value.store_swatches.length} of {SWATCHES_MAX}
            </span>
          </div>
          {value.store_swatches.map((swatch, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="color"
                className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent p-1 dark:border-border-dark"
                aria-label={`Swatch ${i + 1} colour`}
                value={swatch.hex}
                onChange={(e) => setSwatch(i, { hex: e.target.value })}
              />
              <input
                className="input min-w-0 flex-1"
                placeholder="Colour name, e.g. Indigo"
                aria-label={`Swatch ${i + 1} name`}
                maxLength={30}
                value={swatch.name}
                onChange={(e) => setSwatch(i, { name: e.target.value })}
              />
              <button
                type="button"
                className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                aria-label="Remove swatch"
                onClick={() => set({ store_swatches: value.store_swatches.filter((_, si) => si !== i) })}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            disabled={value.store_swatches.length >= SWATCHES_MAX}
            onClick={() => set({ store_swatches: [...value.store_swatches, { name: '', hex: '#000000' }] })}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add colour
          </Button>
        </div>
      </div>

      <div>
        <label htmlFor="store-video-url" className="type-label mb-1.5 block">Product video</label>
        <input
          id="store-video-url"
          type="url"
          inputMode="url"
          className="input w-full"
          placeholder="https://www.youtube.com/watch?v=..."
          value={value.video_url}
          onChange={(e) => set({ video_url: e.target.value })}
        />
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          Paste a YouTube link, or a link to an .mp4 or .webm file. It shows with the product photos.
        </p>
        {value.video_url.trim() ? (
          embed ? (
            <div className="mt-2 flex items-center gap-3 text-sm">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumb} alt="Video preview" className="h-16 w-28 rounded-lg object-cover" />
              ) : (
                <video src={embed.src} className="h-16 w-28 rounded-lg bg-black object-cover" muted preload="metadata" />
              )}
              <span className="text-text-secondary dark:text-text-secondary-dark">This link works.</span>
            </div>
          ) : (
            <p className="mt-2 text-sm text-red-600">This link can&apos;t be played. Use a YouTube link or an .mp4 / .webm file.</p>
          )
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="type-label">Info tabs</span>
          <span className="text-xs text-text-secondary dark:text-text-secondary-dark">
            {value.store_tabs.length} of {TABS_MAX}
          </span>
        </div>
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
          Extra sections on the product page, such as Care, Shipping or Ingredients.
        </p>
        {value.store_tabs.map((tab, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border p-3 dark:border-border-dark">
            <div className="flex items-center gap-2">
              <input
                className="input min-w-0 flex-1"
                placeholder="Tab title, e.g. Care"
                aria-label={`Tab ${i + 1} title`}
                maxLength={40}
                value={tab.title}
                onChange={(e) => setTab(i, { title: e.target.value })}
              />
              <button
                type="button"
                className="rounded-lg p-2 hover:bg-gray-100 disabled:opacity-30"
                aria-label="Move tab up"
                disabled={i === 0}
                onClick={() => set({ store_tabs: moveTab(value.store_tabs, i, -1) })}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded-lg p-2 hover:bg-gray-100 disabled:opacity-30"
                aria-label="Move tab down"
                disabled={i === value.store_tabs.length - 1}
                onClick={() => set({ store_tabs: moveTab(value.store_tabs, i, 1) })}
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                aria-label="Remove tab"
                onClick={() => set({ store_tabs: value.store_tabs.filter((_, ti) => ti !== i) })}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <textarea
              className="input min-h-[96px] w-full resize-y"
              rows={4}
              maxLength={4000}
              placeholder="Write the details here"
              aria-label={`Tab ${i + 1} text`}
              value={tab.body}
              onChange={(e) => setTab(i, { body: e.target.value })}
            />
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={value.store_tabs.length >= TABS_MAX}
          onClick={() => set({ store_tabs: [...value.store_tabs, { title: '', body: '' }] })}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add tab
        </Button>
      </div>

      <div className="space-y-3">
        <Switch
          label="Use category size chart"
          description="Uses the chart set on this item's category. Turn off to give this item its own chart."
          checked={value.size_chart === null}
          onChange={(on) => set({ size_chart: on ? null : (categoryChart ?? emptyChart()) })}
        />
        {value.size_chart === null ? (
          categoryChart ? <ChartPreview chart={categoryChart} /> : (
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark">No chart for this category.</p>
          )
        ) : (
          <CategorySizeChartEditor
            value={value.size_chart}
            onChange={(next) => set({ size_chart: next })}
          />
        )}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {serverError ? <p className="text-sm text-red-600">{serverError}</p> : null}
    </div>
  );
}
