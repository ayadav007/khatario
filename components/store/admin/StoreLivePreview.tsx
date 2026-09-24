'use client';

import { MapPin, Search, ShoppingCart } from 'lucide-react';
import type { StoreTheme } from '@/lib/store/store-theme';
import { resolveHeroSlides } from '@/lib/store/store-theme';
import { StoreCategoryPills } from '@/components/store/StoreCategoryPills';
import { StoreHeroCarousel } from '@/components/store/StoreHeroCarousel';

const SAMPLE_PRODUCTS = [
  { name: 'Tata Salt 1 kg', price: 28, mrp: 32, unit: '1 kg' },
  { name: 'Amul Milk 500 ml', price: 29, mrp: 29, unit: '500 ml' },
  { name: 'Parle-G 250 g', price: 25, mrp: 30, unit: '250 g' },
  { name: 'Toor Dal 1 kg', price: 168, mrp: 189, unit: '1 kg' },
];

export function StoreLivePreview({
  storeName,
  tagline,
  heroUrl,
  theme,
  categories,
}: {
  storeName: string;
  tagline: string;
  heroUrl: string;
  theme: StoreTheme;
  categories: Array<{ id: string; name: string }>;
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

  return (
    <div className="mx-auto w-[280px]">
      <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-wide text-gray-400">
        Live preview
      </p>
      <div className="overflow-hidden rounded-[28px] border-[8px] border-gray-900 bg-white shadow-xl">
        <div className="h-5 bg-gray-900" />
        <div className="max-h-[520px] overflow-y-auto" style={{ backgroundColor: theme.background }}>
          <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="h-7 w-7 rounded-md object-contain" />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-[10px] font-bold">
                {name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-gray-900">{name}</p>
              <p className="flex items-center gap-0.5 text-[9px] text-gray-500">
                <MapPin className="h-2.5 w-2.5" style={{ color: theme.accent }} />
                Deliver to
              </p>
            </div>
            <ShoppingCart className="h-3.5 w-3.5 text-gray-500" />
          </div>
          <div className="relative mx-2 mt-2">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
            <div className="rounded-full border border-gray-200 bg-white py-1.5 pl-7 pr-2 text-[10px] text-gray-400">
              {theme.search_placeholder || 'Search products...'}
            </div>
          </div>
          <div className="px-2 pb-3 pt-2">
            {theme.show_hero ? (
              <StoreHeroCarousel
                compact
                slides={resolveHeroSlides(theme, {
                  image_url: heroUrl,
                  title: tagline || `Shop from ${name}`,
                  subtitle: theme.hero_subtitle || 'Add to cart in one tap.',
                })}
                ctaLabel={theme.hero_cta}
                accent={theme.accent}
              />
            ) : null}

            <div className="scale-[0.92] origin-top">
              <StoreCategoryPills
                categories={previewCats}
                selectedId={null}
                onSelect={() => undefined}
                accent={theme.accent}
                style={theme.category_style}
                images={theme.category_images}
              />
            </div>

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
        </div>
      </div>
    </div>
  );
}
