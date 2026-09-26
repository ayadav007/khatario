'use client';

import { Search } from 'lucide-react';
import type { StoreTheme } from '@/lib/store/store-theme';
import { CHOWK_INK, chowkInkOn, chowkOnAccent, isAetherPack, isAtelierPack, isChowkPack, isKhatarioPack, resolveHeroSlides, sectionEnabled, storeCanvas } from '@/lib/store/store-theme';
import { StoreCategoryPills } from '@/components/store/StoreCategoryPills';
import { StoreHeroCarousel } from '@/components/store/StoreHeroCarousel';

const SAMPLE_PRODUCTS = [
  { name: 'Tata Salt 1 kg', price: 28, mrp: 32, unit: '1 kg' },
  { name: 'Amul Milk 500 ml', price: 29, mrp: 29, unit: '500 ml' },
  { name: 'Parle-G 250 g', price: 25, mrp: 30, unit: '250 g' },
  { name: 'Toor Dal 1 kg', price: 168, mrp: 189, unit: '1 kg' },
];

const SAMPLE_ATELIER = [
  { name: 'Merino Crewneck', price: 195, mrp: 195, unit: 'Sand' },
  { name: 'Linen Overshirt', price: 145, mrp: 180, unit: 'Olive' },
  { name: 'Pleated Wool Trouser', price: 160, mrp: 160, unit: 'Grey' },
  { name: 'Brushed Mohair Cardigan', price: 210, mrp: 240, unit: 'Heather' },
];

export function StoreLivePreview({
  storeName,
  tagline,
  heroUrl,
  theme,
  categories,
  iframeSrc = null,
  updating = false,
}: {
  storeName: string;
  tagline: string;
  heroUrl: string;
  theme: StoreTheme;
  categories: Array<{ id: string; name: string }>;
  iframeSrc?: string | null;
  updating?: boolean;
}) {
  const name = storeName.trim() || 'Your store';
  const logo = theme.logo_url;
  const cols = theme.mobile_columns === 3 ? 'grid-cols-3' : 'grid-cols-2';
  const previewCats =
    categories.length > 0
      ? categories.slice(0, 6)
      : [
          { id: 'groc', name: 'Grocery' },
          { id: 'dairy', name: 'Dairy' },
          { id: 'snacks', name: 'Snacks' },
        ];
  const chowk = isChowkPack(theme);
  const atelier = isAtelierPack(theme);
  const khatario = isKhatarioPack(theme);
  const aether = isAetherPack(theme);
  const paper = storeCanvas(theme);
  const ink = chowk || atelier || khatario || aether ? chowkInkOn(paper) : CHOWK_INK;
  const hair = `color-mix(in srgb, ${ink} 12%, transparent)`;
  const showCats = sectionEnabled(theme, 'categories');

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
          <>
            <iframe
              key={iframeSrc}
              title="Store live preview"
              src={iframeSrc}
              className="h-[min(780px,calc(100vh-11rem))] w-full border-0 bg-white"
            />
            {updating ? (
              <div className="absolute inset-0 top-7 flex items-center justify-center bg-white/70 text-xs font-medium text-gray-600">
                Updating preview…
              </div>
            ) : null}
          </>
        ) : (
        <div className="max-h-[520px] overflow-y-auto" style={{ backgroundColor: paper }}>
          {khatario ? (
            <>
              <div
                className="rounded-b-2xl px-3 pb-2 pt-2"
                style={{ backgroundColor: theme.accent, color: chowkOnAccent(theme.accent) }}
              >
                <div className="flex items-center gap-2">
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt="" className="h-7 w-7 rounded-md bg-white object-contain p-0.5" />
                  ) : (
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-bold"
                      style={{ backgroundColor: chowkOnAccent(theme.accent), color: theme.accent }}
                    >
                      {name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <p className="min-w-0 flex-1 truncate text-[12px] font-bold">{name}</p>
                </div>
                <div className="relative mt-2">
                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                  <div className="rounded-xl bg-white py-1.5 pl-7 pr-2 text-[10px] text-gray-400">
                    {theme.search_placeholder || 'Search for items…'}
                  </div>
                </div>
                {theme.show_hero ? (
                  <div className="mt-2">
                    <StoreHeroCarousel
                      compact
                      variant="khatario"
                      slides={resolveHeroSlides(theme, {
                        image_url: heroUrl,
                        title: tagline || name,
                        subtitle: theme.hero_subtitle,
                      })}
                      ctaLabel=""
                      accent={theme.accent}
                    />
                  </div>
                ) : null}
              </div>
              <div className="px-2 pb-3 pt-2">
                {showCats ? (
                <StoreCategoryPills
                  categories={previewCats}
                  selectedId={null}
                  onSelect={() => undefined}
                  accent={theme.accent}
                  style={theme.category_style}
                  images={theme.category_images}
                  variant="khatario"
                  paper={paper}
                />
                ) : null}
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {SAMPLE_PRODUCTS.slice(0, 4).map((p) => (
                    <div key={p.name} className="overflow-hidden rounded-xl bg-white shadow-sm">
                      <div className="relative aspect-square bg-gray-100" />
                      <div className="p-1.5">
                        <p className="line-clamp-2 min-h-[1.6rem] text-[9px] font-medium text-gray-900">{p.name}</p>
                        <p className="text-[10px] font-semibold" style={{ color: theme.accent }}>
                          ₹{p.price}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : aether ? (
            <>
              <div className="relative px-3 py-3" style={{ color: ink }}>
                <p className="text-center font-noir-display text-[13px] tracking-[0.28em]">{name}</p>
              </div>
              {theme.show_hero ? (
                <StoreHeroCarousel
                  compact
                  variant="aether"
                  paper={paper}
                  slides={resolveHeroSlides(theme, {
                    image_url: heroUrl,
                    title: tagline || name,
                    subtitle: theme.hero_subtitle,
                  })}
                  ctaLabel={theme.hero_cta}
                  accent={theme.accent}
                />
              ) : null}
              {theme.announcement ? (
                <p
                  className="truncate px-3 py-1.5 text-center text-[8px] uppercase tracking-[0.22em]"
                  style={{ color: theme.accent, borderTop: `1px solid ${theme.accent}33`, borderBottom: `1px solid ${theme.accent}33` }}
                >
                  {theme.announcement}
                </p>
              ) : null}
              <p className="px-3 pt-3 font-noir-display text-[12px]" style={{ color: ink }}>
                This season
              </p>
              <div className="grid grid-cols-2 gap-2 px-3 pb-3 pt-1">
                {SAMPLE_ATELIER.slice(0, 4).map((p) => (
                  <div key={p.name}>
                    <div className="relative aspect-[3/4]" style={{ backgroundColor: `color-mix(in srgb, ${theme.accent} 14%, ${paper})` }}>
                      {p.mrp > p.price ? (
                        <span
                          className="absolute left-1 top-1 px-1 text-[7px]"
                          style={{ backgroundColor: theme.accent, color: paper }}
                        >
                          {Math.round(((p.mrp - p.price) / p.mrp) * 100)}%
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1.5 font-noir-display text-[10px] leading-tight" style={{ color: ink }}>
                      {p.name}
                    </p>
                    <p className="text-[9px] tabular-nums" style={{ color: theme.accent }}>
                      ₹{p.price}
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : atelier ? (
            <>
              <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${hair}` }}>
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="h-6 w-auto max-w-[5rem] object-contain object-left" />
                ) : (
                  <p className="truncate font-serif text-[12px] tracking-[0.16em]" style={{ color: ink }}>
                    {name}
                  </p>
                )}
                <span className="text-[9px]" style={{ color: ink, opacity: 0.55 }}>
                  Bag
                </span>
              </div>
              <div className="px-3 py-2">
                <div
                  className="flex items-center gap-1 rounded-full px-2 py-1.5 text-[9px]"
                  style={{ backgroundColor: `color-mix(in srgb, ${ink} 6%, ${paper})`, color: ink, opacity: 0.5 }}
                >
                  <Search className="h-3 w-3" />
                  {theme.search_placeholder || 'Search jackets…'}
                </div>
              </div>
              {showCats ? (
              <StoreCategoryPills
                categories={
                  categories.length > 0
                    ? previewCats
                    : [
                        { id: 'knit', name: 'Knitwear' },
                        { id: 'tailor', name: 'Tailoring' },
                        { id: 'outer', name: 'Outerwear' },
                      ]
                }
                selectedId={null}
                onSelect={() => undefined}
                accent={theme.accent}
                style={theme.category_style}
                images={theme.category_images}
                variant="atelier"
                paper={paper}
              />
              ) : null}
              {theme.show_hero ? (
                <StoreHeroCarousel
                  compact
                  variant="atelier"
                  paper={paper}
                  slides={resolveHeroSlides(theme, {
                    image_url: heroUrl,
                    title: tagline || name,
                    subtitle: theme.hero_subtitle,
                  })}
                  ctaLabel={theme.hero_cta}
                  accent={theme.accent}
                />
              ) : null}
              <p className="px-3 pt-2 font-serif text-[11px]" style={{ color: ink }}>
                Trending Now
              </p>
              <div className="grid grid-cols-2 gap-2 px-3 pb-3 pt-1">
                {SAMPLE_ATELIER.slice(0, 4).map((p) => (
                  <div key={p.name}>
                    <div className="relative aspect-[3/4] rounded-xl" style={{ backgroundColor: `color-mix(in srgb, ${ink} 8%, ${paper})` }}>
                      {p.mrp > p.price ? (
                        <span
                          className="absolute left-1 top-1 rounded-full px-1 text-[7px]"
                          style={{ backgroundColor: theme.accent, color: paper }}
                        >
                          {Math.round(((p.mrp - p.price) / p.mrp) * 100)}%
                        </span>
                      ) : null}
                      <span
                        className="absolute bottom-1 right-1 rounded-full px-1.5 py-0.5 text-[7px]"
                        style={{ backgroundColor: theme.accent, color: paper }}
                      >
                        + Add
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[8px]" style={{ color: ink }}>
                      {p.name}
                    </p>
                    <p className="text-[9px] font-medium" style={{ color: ink }}>
                      ₹{p.price}
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : chowk ? (
            <>
              {theme.show_offers ? (
                <p
                  className="px-2 py-1 text-center text-[8px] font-medium uppercase tracking-wider"
                  style={{
                    color: ink,
                    backgroundColor: `color-mix(in srgb, ${theme.accent} 8%, ${paper})`,
                  }}
                >
                  {tagline || 'In the shop today'}
                </p>
              ) : null}
              <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${hair}` }}>
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="h-7 max-h-7 w-auto max-w-[4.5rem] object-contain object-left" />
                ) : (
                  <div
                    className="flex h-7 w-7 items-center justify-center text-[12px]"
                    style={{ border: `1px solid ${hair}`, fontFamily: 'Georgia, serif' }}
                  >
                    {name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <p className="min-w-0 flex-1 truncate text-[11px] font-semibold" style={{ color: ink }}>
                  {name}
                </p>
                <span className="text-[10px]" style={{ color: ink }}>
                  Bag
                </span>
              </div>
              <div className="px-3 py-2">
                <div
                  className="flex items-center gap-1 border-b pb-1 text-[10px]"
                  style={{ borderColor: hair, color: `color-mix(in srgb, ${ink} 40%, transparent)` }}
                >
                  <Search className="h-3 w-3" />
                  {theme.search_placeholder || 'Search the shop'}
                </div>
              </div>
              {showCats ? (
              <StoreCategoryPills
                categories={previewCats}
                selectedId={null}
                onSelect={() => undefined}
                accent={theme.accent}
                style={theme.category_style}
                images={theme.category_images}
                variant="chowk"
                paper={paper}
              />
              ) : null}
              {theme.show_hero ? (
                <StoreHeroCarousel
                  compact
                  variant="chowk"
                  paper={paper}
                  slides={resolveHeroSlides(theme, {
                    image_url: heroUrl,
                    title: tagline || name,
                    subtitle: theme.hero_subtitle,
                  })}
                  ctaLabel={theme.hero_cta}
                  accent={theme.accent}
                />
              ) : null}
              <div className={`grid ${cols} gap-px`} style={{ backgroundColor: hair }}>
                {SAMPLE_PRODUCTS.slice(0, theme.mobile_columns === 3 ? 3 : 4).map((p) => (
                  <div key={p.name} className="pb-2" style={{ backgroundColor: paper }}>
                    <div className="relative aspect-square">
                      {p.mrp > p.price ? (
                        <span
                          className="absolute left-0 top-0 px-1 text-[8px]"
                          style={{ backgroundColor: theme.accent, color: paper }}
                        >
                          {Math.round(((p.mrp - p.price) / p.mrp) * 100)}%
                        </span>
                      ) : null}
                      <span
                        className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center text-[10px]"
                        style={{ border: `1px solid ${hair}`, color: theme.accent }}
                      >
                        +
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 px-1 text-[9px]" style={{ color: ink }}>
                      {p.name}
                    </p>
                    <p className="px-1 text-[10px] font-semibold" style={{ color: theme.accent }}>
                      ₹{p.price}
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div
                className="rounded-b-2xl px-3 pb-2 pt-2"
                style={{ backgroundColor: theme.accent, color: chowkOnAccent(theme.accent) }}
              >
                <div className="flex items-center gap-2">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="h-7 w-7 rounded-md bg-white object-contain p-0.5" />
                ) : (
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-bold"
                    style={{ backgroundColor: chowkOnAccent(theme.accent), color: theme.accent }}
                  >
                    {name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold">{name}</p>
                  <p className="text-[9px] opacity-80">Deliver to</p>
                </div>
                </div>
                <div className="relative mt-2">
                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                  <div className="rounded-full bg-white py-1.5 pl-7 pr-2 text-[10px] text-gray-400">
                    {theme.search_placeholder || 'Search products...'}
                  </div>
                </div>
                {theme.show_hero ? (
                  <div className="mt-2">
                    <StoreHeroCarousel
                      compact
                      flush
                      slides={resolveHeroSlides(theme, {
                        image_url: heroUrl,
                        title: tagline || `Shop from ${name}`,
                        subtitle: theme.hero_subtitle || 'Add to cart in one tap.',
                      })}
                      ctaLabel={theme.hero_cta}
                      accent={theme.accent}
                    />
                  </div>
                ) : null}
              </div>
              <div className="px-2 pb-3 pt-2">

                {showCats ? (
                <div className="origin-top scale-[0.92]">
                  <StoreCategoryPills
                    categories={previewCats}
                    selectedId={null}
                    onSelect={() => undefined}
                    accent={theme.accent}
                    style={theme.category_style}
                    images={theme.category_images}
                  />
                </div>
                ) : null}

                {theme.show_offers ? (
                  <p className="mb-1 text-[10px] font-semibold text-gray-900">Today&apos;s offers</p>
                ) : null}

                <div className={`grid ${cols} gap-1.5`}>
                  {SAMPLE_PRODUCTS.slice(0, theme.mobile_columns === 3 ? 3 : 4).map((p) => (
                    <div key={p.name} className="overflow-hidden rounded-lg border border-gray-100 bg-white">
                      <div className="relative aspect-square bg-gray-100">
                        {p.mrp > p.price ? (
                          <span
                            className="absolute left-1 top-1 rounded px-1 text-[8px] font-bold text-white"
                            style={{ backgroundColor: theme.accent }}
                          >
                            {Math.round(((p.mrp - p.price) / p.mrp) * 100)}% OFF
                          </span>
                        ) : null}
                      </div>
                      <div className="p-1.5">
                        <p className="line-clamp-2 min-h-[1.6rem] text-[9px] font-medium text-gray-900">{p.name}</p>
                        <div className="mt-1 flex items-end justify-between">
                          <p className="text-[10px] font-bold">₹{p.price}</p>
                          <span
                            className="rounded px-1.5 py-0.5 text-[8px] font-semibold"
                            style={{ border: `1px solid ${theme.accent}`, color: theme.accent }}
                          >
                            Add
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
