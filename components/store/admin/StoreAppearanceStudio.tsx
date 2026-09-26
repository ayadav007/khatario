'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { StoreImageField } from '@/components/store/admin/StoreImageField';
import { Button } from '@/components/ui/Button';
import {
  applyStorePreset,
  GALLERY_PACKS,
  STORE_FONT_FAMILIES,
  STORE_THEME_PRESETS,
  newProductShelf,
  sanitizeStoreTheme,
  type StoreAppearanceMode,
  type StoreHomepageSectionId,
  type StoreTheme,
  type StoreThemePreset,
} from '@/lib/store/store-theme';
import { THEME_DEMO_SLUGS } from '@/lib/store/theme-demo';

type Pane = 'background' | 'header' | 'banners' | 'sections' | 'collections' | 'fonts' | 'advanced';

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent',
        on ? 'bg-green-500' : 'bg-gray-200',
      )}
    >
      <span
        className={clsx(
          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow',
          on ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

function demoOrigin(slug: string, hostSuffix: string) {
  const port = typeof window !== 'undefined' && window.location.port ? `:${window.location.port}` : '';
  const proto = typeof window !== 'undefined' ? window.location.protocol : 'http:';
  return `${proto}//${slug}${hostSuffix}${hostSuffix === '.localhost' ? port : ''}`;
}

const SECTION_LABEL: Record<StoreHomepageSectionId, string> = {
  hero: 'Hero banner',
  categories: 'Category tiles',
  featured: 'Featured product',
  offers: "Today's offers",
  product_shelves: 'Product collections',
  category_shelves: 'Shop by category rows',
  overlay: 'Image with overlay',
  testimonials: 'Customer testimonials',
  brand_story: 'Brand story',
  trust: 'Trust row',
  catalog: 'Product grid',
};

export function StoreAppearanceStudio({
  theme,
  setTheme,
  hideBadge,
  setHideBadge,
  tagline,
  setTagline,
  categories,
  hostSuffix,
  storeUrl,
  onUpdate,
  updating,
}: {
  theme: StoreTheme;
  setTheme: Dispatch<SetStateAction<StoreTheme>>;
  hideBadge: boolean;
  setHideBadge: (v: boolean) => void;
  tagline: string;
  setTagline: (v: string) => void;
  categories: Array<{ id: string; name: string }>;
  hostSuffix: string;
  storeUrl: string | null;
  onUpdate: () => void;
  updating: boolean;
}) {
  const [screen, setScreen] = useState<'gallery' | 'customize'>('gallery');
  const [pane, setPane] = useState<Pane>('background');

  const applyPack = (preset: Exclude<StoreThemePreset, 'custom'>) => {
    if (
      !window.confirm(
        'Apply this theme layout? Logo, banners, and homepage copy stay. Pack defaults (grid, paper) will change.',
      )
    ) {
      return;
    }
    setTheme((t) => sanitizeStoreTheme({ ...t, ...applyStorePreset(preset) }));
    setScreen('customize');
  };

  const openDemo = (preset: Exclude<StoreThemePreset, 'custom'>) => {
    const pack = STORE_THEME_PRESETS[preset].pack;
    const slug = Object.entries(THEME_DEMO_SLUGS).find(([, v]) => v.pack === pack)?.[0];
    if (!slug) return;
    window.open(demoOrigin(slug, hostSuffix), '_blank', 'noopener,noreferrer');
  };

  const previewMerchant = async () => {
    if (!storeUrl) {
      window.alert('Set a store URL under Store setup first.');
      return;
    }
    const res = await fetch('/api/settings/online-store/preview-draft', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    });
    const data = await res.json().catch(() => ({}));
    const proto = window.location.protocol;
    const port = hostSuffix === '.localhost' && window.location.port ? `:${window.location.port}` : '';
    const q = data.token ? `?td=${encodeURIComponent(data.token)}` : '';
    window.open(`${proto}//${storeUrl}${port}/${q}`, '_blank', 'noopener,noreferrer');
  };

  if (screen === 'gallery') {
    return (
      <div>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Themes</h2>
            <p className="mt-1 text-sm text-gray-500">Apply a pack, then customize. Update preview shows your store in the phone. Save publishes it.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {GALLERY_PACKS.map((g) => {
            const active = theme.pack === g.pack;
            return (
              <article key={g.pack} className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="relative aspect-[4/3] bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/store/themes/${g.pack}.svg`}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    className="absolute inset-0 flex items-center justify-center bg-black/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-black/45 group-hover:opacity-100"
                    onClick={() => openDemo(g.preset)}
                  >
                    Preview theme <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-3">
                  <div>
                    <p className="font-medium text-gray-900">{g.label}</p>
                    <p className="text-[11px] text-gray-500">{g.blurb}</p>
                  </div>
                  {active ? (
                    <Button type="button" size="sm" onClick={() => setScreen('customize')}>
                      Customize
                    </Button>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => applyPack(g.preset)}>
                      Apply
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    );
  }

  const PANES: Array<{ id: Pane; label: string }> = [
    { id: 'background', label: 'Background' },
    { id: 'header', label: 'Header & Favicon' },
    { id: 'banners', label: 'Banners' },
    { id: 'sections', label: 'Sections' },
    { id: 'collections', label: 'Collections' },
    { id: 'fonts', label: 'Fonts' },
    { id: 'advanced', label: 'Advanced' },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <button type="button" className="text-sm text-gray-600" onClick={() => setScreen('gallery')}>
          ← Themes
        </button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void previewMerchant()}>
            Preview
          </Button>
          <Button type="button" size="sm" onClick={onUpdate} disabled={updating}>
            {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Update preview'}
          </Button>
        </div>
      </div>
      <div className="grid md:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="border-b md:border-b-0 md:border-r">
          {PANES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={clsx(
                'block w-full px-4 py-2.5 text-left text-sm',
                pane === p.id ? 'bg-gray-50 font-medium text-blue-700' : 'text-gray-700',
              )}
              onClick={() => setPane(p.id)}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          {pane === 'background' ? (
            <>
              <p className="text-sm text-gray-600">Page paper. Brand colour stays on buttons.</p>
              <div className="grid grid-cols-3 gap-3">
                {(['light', 'dim', 'dark'] as StoreAppearanceMode[]).map((mode) => (
                  <label key={mode} className="cursor-pointer rounded-xl border p-3 text-center text-sm capitalize">
                    <input
                      type="radio"
                      className="mb-2"
                      checked={theme.appearance_mode === mode}
                      onChange={() => setTheme((t) => ({ ...t, appearance_mode: mode, preset: 'custom' }))}
                    />
                    <span className="block">{mode}</span>
                  </label>
                ))}
              </div>
              <label className="block text-xs text-gray-500">
                Brand colour
                <input
                  type="color"
                  className="mt-1 block h-10 w-16"
                  value={theme.accent}
                  onChange={(e) => setTheme((t) => ({ ...t, preset: 'custom', accent: e.target.value }))}
                />
              </label>
            </>
          ) : null}

          {pane === 'header' ? (
            <>
              <StoreImageField
                label="Store logo"
                hint="Shown in the header. Leave empty to use your business logo."
                value={theme.logo_url}
                onChange={(url) => setTheme((t) => ({ ...t, logo_url: url }))}
              />
              <label className="flex items-center justify-between text-sm">
                Show store name beside the logo
                <Toggle on={theme.show_store_name} onToggle={() => setTheme((t) => ({ ...t, show_store_name: !t.show_store_name }))} />
              </label>
              <StoreImageField
                label="Favicon"
                hint="Square image, at least 48×48."
                value={theme.favicon_url}
                onChange={(url) => setTheme((t) => ({ ...t, favicon_url: url }))}
              />
              <label className="block text-xs text-gray-500">
                Search placeholder
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={theme.search_placeholder}
                  onChange={(e) => setTheme((t) => ({ ...t, search_placeholder: e.target.value }))}
                />
              </label>
              <label className="block text-xs text-gray-500">
                Announcement bar
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={theme.announcement}
                  maxLength={160}
                  onChange={(e) => setTheme((t) => ({ ...t, announcement: e.target.value }))}
                />
              </label>
            </>
          ) : null}

          {pane === 'banners' ? (
            <>
              <p className="text-xs text-gray-500">Up to 6 homepage banners. Set mobile, desktop, or both.</p>
              <label className="block text-xs text-gray-500">
                Default tagline
                <input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={tagline} maxLength={120} onChange={(e) => setTagline(e.target.value)} />
              </label>
              <label className="block text-xs text-gray-500">
                Button text
                <input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={theme.hero_cta} onChange={(e) => setTheme((t) => ({ ...t, hero_cta: e.target.value }))} />
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={theme.hero_slides.length >= 6}
                onClick={() =>
                  setTheme((t) => ({
                    ...t,
                    hero_slides: [...t.hero_slides, { image_url: '', title: tagline, subtitle: t.hero_subtitle, viewport: 'both' }],
                  }))
                }
              >
                Add banner
              </Button>
              {theme.hero_slides.map((slide, i) => (
                <div key={i} className="space-y-2 rounded-xl border p-3">
                  <div className="flex justify-between text-xs font-medium">
                    Slide {i + 1}
                    <button type="button" className="text-red-600" onClick={() => setTheme((t) => ({ ...t, hero_slides: t.hero_slides.filter((_, idx) => idx !== i) }))}>
                      Remove
                    </button>
                  </div>
                  <StoreImageField
                    label="Image"
                    value={slide.image_url}
                    onChange={(url) =>
                      setTheme((t) => ({
                        ...t,
                        hero_slides: t.hero_slides.map((s, idx) => (idx === i ? { ...s, image_url: url } : s)),
                      }))
                    }
                  />
                  <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Title" value={slide.title} onChange={(e) => setTheme((t) => ({ ...t, hero_slides: t.hero_slides.map((s, idx) => (idx === i ? { ...s, title: e.target.value } : s)) }))} />
                  <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Subtitle" value={slide.subtitle} onChange={(e) => setTheme((t) => ({ ...t, hero_slides: t.hero_slides.map((s, idx) => (idx === i ? { ...s, subtitle: e.target.value } : s)) }))} />
                  <select
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    value={slide.viewport}
                    onChange={(e) =>
                      setTheme((t) => ({
                        ...t,
                        hero_slides: t.hero_slides.map((s, idx) => (idx === i ? { ...s, viewport: e.target.value as StoreTheme['hero_slides'][0]['viewport'] } : s)),
                      }))
                    }
                  >
                    <option value="both">Mobile and desktop</option>
                    <option value="mobile">Mobile only</option>
                    <option value="desktop">Desktop only</option>
                  </select>
                </div>
              ))}
            </>
          ) : null}

          {pane === 'sections' ? (
            <>
              <p className="text-xs text-gray-500">
                Toggle blocks and use arrows to reorder the home page. Then click Update preview.
                Featured products are chosen on Items (up to 6). Product collections are set under Collections.
              </p>
              {theme.homepage_sections.map((row, i) => (
                <div key={row.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <div className="flex flex-col">
                    <button type="button" disabled={i === 0} className="text-xs disabled:opacity-30" onClick={() => setTheme((t) => {
                      const next = [...t.homepage_sections];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      return { ...t, homepage_sections: next };
                    })}>↑</button>
                    <button type="button" disabled={i === theme.homepage_sections.length - 1} className="text-xs disabled:opacity-30" onClick={() => setTheme((t) => {
                      const next = [...t.homepage_sections];
                      [next[i + 1], next[i]] = [next[i], next[i + 1]];
                      return { ...t, homepage_sections: next };
                    })}>↓</button>
                  </div>
                  <span className="flex-1 text-sm">{SECTION_LABEL[row.id]}</span>
                  <Toggle
                    on={row.enabled}
                    onToggle={() =>
                      setTheme((t) => ({
                        ...t,
                        homepage_sections: t.homepage_sections.map((s) => (s.id === row.id ? { ...s, enabled: !s.enabled } : s)),
                        show_hero: row.id === 'hero' ? !row.enabled : t.show_hero,
                        show_offers: row.id === 'offers' ? !row.enabled : t.show_offers,
                        show_trust: row.id === 'trust' ? !row.enabled : t.show_trust,
                      }))
                    }
                  />
                </div>
              ))}
              <label className="block text-xs text-gray-500">
                Brand story
                <textarea className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={3} value={theme.brand_story} onChange={(e) => setTheme((t) => ({ ...t, brand_story: e.target.value }))} />
              </label>
              {theme.testimonials.map((tm, i) => (
                <div key={i} className="space-y-1 rounded-lg border p-2">
                  <input className="w-full rounded border px-2 py-1 text-sm" placeholder="Name" value={tm.name} onChange={(e) => setTheme((t) => ({ ...t, testimonials: t.testimonials.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)) }))} />
                  <textarea className="w-full rounded border px-2 py-1 text-sm" placeholder="Quote" value={tm.text} onChange={(e) => setTheme((t) => ({ ...t, testimonials: t.testimonials.map((x, idx) => (idx === i ? { ...x, text: e.target.value } : x)) }))} />
                </div>
              ))}
              {theme.testimonials.length < 6 ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setTheme((t) => ({ ...t, testimonials: [...t.testimonials, { name: '', text: '', photo_url: '' }] }))}>
                  Add testimonial
                </Button>
              ) : null}
              {theme.overlay_bands.map((b, i) => (
                <div key={i} className="space-y-1 rounded-lg border p-2">
                  <StoreImageField label={`Overlay ${i + 1}`} value={b.image_url} onChange={(url) => setTheme((t) => ({ ...t, overlay_bands: t.overlay_bands.map((x, idx) => (idx === i ? { ...x, image_url: url } : x)) }))} />
                  <input className="w-full rounded border px-2 py-1 text-sm" placeholder="Caption" value={b.caption} onChange={(e) => setTheme((t) => ({ ...t, overlay_bands: t.overlay_bands.map((x, idx) => (idx === i ? { ...x, caption: e.target.value } : x)) }))} />
                </div>
              ))}
              {theme.overlay_bands.length < 3 ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setTheme((t) => ({ ...t, overlay_bands: [...t.overlay_bands, { image_url: '', caption: '', cta: '' }] }))}>
                  Add overlay
                </Button>
              ) : null}
              <div>
                <p className="text-sm">Product grid on phone</p>
                <div className="mt-2 flex gap-2">
                  {([2, 3] as const).map((n) => (
                    <button key={n} type="button" className={clsx('rounded-lg border px-3 py-1.5 text-sm', theme.mobile_columns === n && 'border-gray-900 font-medium')} onClick={() => setTheme((t) => ({ ...t, mobile_columns: n }))}>
                      {n} columns
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-sm">Category tiles</p>
              <div className="flex gap-2">
                {(['letter', 'icon', 'photo'] as const).map((id) => (
                  <button key={id} type="button" className={clsx('rounded-lg border px-3 py-1.5 text-sm capitalize', theme.category_style === id && 'border-gray-900 font-medium')} onClick={() => setTheme((t) => ({ ...t, category_style: id }))}>
                    {id}
                  </button>
                ))}
              </div>
              {theme.category_style === 'photo'
                ? categories.map((cat) => (
                    <StoreImageField
                      key={cat.id}
                      label={cat.name}
                      value={theme.category_images[cat.id] ?? ''}
                      onChange={(url) =>
                        setTheme((t) => {
                          const next = { ...t.category_images };
                          if (url) next[cat.id] = url;
                          else delete next[cat.id];
                          return { ...t, category_images: next };
                        })
                      }
                    />
                  ))
                : null}
            </>
          ) : null}

          {pane === 'collections' ? (
            <>
              <p className="text-xs text-gray-500">
                Add homepage rows such as On sale or Under ₹99. Turn on Product collections under Sections, then Update preview.
              </p>
              {theme.product_shelves.map((shelf, i) => (
                <div key={shelf.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <input
                      className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
                      value={shelf.title}
                      onChange={(e) =>
                        setTheme((t) => ({
                          ...t,
                          product_shelves: t.product_shelves.map((s, idx) =>
                            idx === i ? { ...s, title: e.target.value } : s,
                          ),
                        }))
                      }
                    />
                    <Toggle
                      on={shelf.enabled}
                      onToggle={() =>
                        setTheme((t) => ({
                          ...t,
                          product_shelves: t.product_shelves.map((s, idx) =>
                            idx === i ? { ...s, enabled: !s.enabled } : s,
                          ),
                        }))
                      }
                    />
                  </div>
                  <select
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    value={shelf.kind}
                    onChange={(e) => {
                      const kind = e.target.value as 'discounted' | 'price_max';
                      setTheme((t) => ({
                        ...t,
                        product_shelves: t.product_shelves.map((s, idx) =>
                          idx === i
                            ? {
                                ...s,
                                kind,
                                title:
                                  kind === 'discounted'
                                    ? s.kind === 'discounted'
                                      ? s.title
                                      : 'On sale'
                                    : s.kind === 'price_max'
                                      ? s.title
                                      : `Under ₹${s.price_max}`,
                              }
                            : s,
                        ),
                      }));
                    }}
                  >
                    <option value="discounted">Discounted (MRP higher than selling price)</option>
                    <option value="price_max">Selling price at most</option>
                  </select>
                  {shelf.kind === 'price_max' ? (
                    <label className="block text-xs text-gray-500">
                      Max selling price (₹)
                      <input
                        type="number"
                        min={1}
                        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                        value={shelf.price_max}
                        onChange={(e) => {
                          const n = Math.max(1, Math.round(Number(e.target.value) || 1));
                          setTheme((t) => ({
                            ...t,
                            product_shelves: t.product_shelves.map((s, idx) =>
                              idx === i
                                ? {
                                    ...s,
                                    price_max: n,
                                    title: /^Under ₹\d+$/.test(s.title) ? `Under ₹${n}` : s.title,
                                  }
                                : s,
                            ),
                          }));
                        }}
                      />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    className="text-xs text-red-600"
                    onClick={() =>
                      setTheme((t) => ({
                        ...t,
                        product_shelves: t.product_shelves.filter((_, idx) => idx !== i),
                      }))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              {theme.product_shelves.length < 8 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setTheme((t) => ({
                      ...t,
                      product_shelves: [...t.product_shelves, newProductShelf('price_max')],
                      homepage_sections: t.homepage_sections.map((s) =>
                        s.id === 'product_shelves' ? { ...s, enabled: true } : s,
                      ),
                    }))
                  }
                >
                  Add collection
                </Button>
              ) : null}
            </>
          ) : null}

          {pane === 'fonts' ? (
            <label className="block text-xs text-gray-500">
              Store font
              <select className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={theme.font_family} onChange={(e) => setTheme((t) => ({ ...t, font_family: e.target.value as StoreTheme['font_family'] }))}>
                {STORE_FONT_FAMILIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {pane === 'advanced' ? (
            <>
              <label className="flex items-center justify-between text-sm">
                Add to bag on listing cards
                <Toggle on={theme.show_listing_add} onToggle={() => setTheme((t) => ({ ...t, show_listing_add: !t.show_listing_add }))} />
              </label>
              <label className="flex items-center justify-between text-sm">
                Sticky buy now (mobile product page)
                <Toggle on={theme.sticky_buy_now} onToggle={() => setTheme((t) => ({ ...t, sticky_buy_now: !t.sticky_buy_now }))} />
              </label>
              <label className="flex items-center justify-between text-sm">
                Hide “Powered by Khatario”
                <Toggle on={hideBadge} onToggle={() => setHideBadge(!hideBadge)} />
              </label>
              <label className="block text-xs text-gray-500">
                Instagram URL
                <input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={theme.instagram_url} onChange={(e) => setTheme((t) => ({ ...t, instagram_url: e.target.value }))} />
              </label>
              <label className="block text-xs text-gray-500">
                WhatsApp URL
                <input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={theme.whatsapp_url} onChange={(e) => setTheme((t) => ({ ...t, whatsapp_url: e.target.value }))} />
              </label>
              <label className="block text-xs text-gray-500">
                Custom CSS
                <textarea className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-xs" rows={8} value={theme.custom_css} onChange={(e) => setTheme((t) => ({ ...t, custom_css: e.target.value }))} />
                <span className="mt-1 block">No scripts or @import. Max 8,000 characters.</span>
              </label>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

