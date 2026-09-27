'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { StoreProductCard, type StoreProduct } from './StoreProductCard';
import { StoreProductShelves } from './StoreProductShelves';
import { groceryDeep } from './StoreGroceryChrome';
import { groceryCategoryEmoji } from '@/lib/store/grocery';
import { storeDiscountPercent } from '@/lib/store/map-store-product';
import { chowkOnAccent, hexLuminance, sectionEnabled, type StoreHeroSlide, type StoreTheme } from '@/lib/store/store-theme';

export interface GroceryCategory {
  id: string;
  name: string;
  item_count?: number;
}

type SortKey = 'default' | 'price-asc' | 'price-desc' | 'discount';

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function Reveal({ children, className, id, delay = 0 }: { children: ReactNode; className?: string; id?: string; delay?: number }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <section
      ref={ref}
      id={id}
      className={clsx('g-reveal', shown && 'is-in', className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </section>
  );
}

export function GroceryChips({
  categories,
  selectedId,
  onSelect,
  accent,
  ink,
}: {
  categories: GroceryCategory[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  accent: string;
  ink: string;
}) {
  if (categories.length === 0) return null;
  const chip = (active: boolean) =>
    clsx(
      'g-line shrink-0 rounded-full border px-4 py-1.5 text-[13px] font-semibold transition-colors',
      active ? '' : 'hover:border-[var(--store-accent)]',
    );
  const activeStyle = { backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`, borderColor: `color-mix(in srgb, ${accent} 35%, transparent)`, color: accent };
  return (
    <div className="g-chips flex gap-2 overflow-x-auto py-2.5" role="tablist" aria-label="Categories">
      <button type="button" role="tab" aria-selected={!selectedId} className={chip(!selectedId)} style={!selectedId ? activeStyle : { color: ink }} onClick={() => onSelect(null)}>
        All
      </button>
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          role="tab"
          aria-selected={selectedId === c.id}
          className={chip(selectedId === c.id)}
          style={selectedId === c.id ? activeStyle : { color: ink }}
          onClick={() => onSelect(c.id)}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

function HeroCard({
  slides,
  theme,
  dark,
  stats,
  storeName,
}: {
  slides: StoreHeroSlide[];
  theme: StoreTheme;
  dark: boolean;
  stats: string[];
  storeName: string;
}) {
  const [idx, setIdx] = useState(0);
  const accent = theme.accent;
  const onAccent = chowkOnAccent(accent);
  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), 6500);
    return () => clearInterval(t);
  }, [slides.length]);
  const slide = slides[Math.min(idx, slides.length - 1)];
  const bg = dark
    ? `linear-gradient(135deg, color-mix(in srgb, ${accent} 22%, #0d1711), color-mix(in srgb, ${accent} 34%, #0d1711))`
    : `linear-gradient(135deg, color-mix(in srgb, ${accent} 14%, #ffffff), color-mix(in srgb, ${accent} 24%, #ffffff))`;
  return (
    <div className="relative overflow-hidden rounded-[28px] px-6 py-9 sm:px-10 sm:py-12 lg:px-14" style={{ background: bg }}>
      <div className="relative z-10 grid items-center gap-8 md:grid-cols-2">
        <div>
          <span
            className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-bold"
            style={{ backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.75)', color: accent }}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
            {storeName}
          </span>
          <h1 key={`t-${idx}`} className="mt-4 text-[clamp(34px,5vw,64px)] font-black leading-[1.02] tracking-[-0.03em]">
            {slide.title}
          </h1>
          {slide.subtitle ? (
            <p className="mt-4 max-w-md text-[15px] leading-relaxed sm:text-base" style={{ opacity: 0.7 }}>
              {slide.subtitle}
            </p>
          ) : null}
          <div className="mt-7 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => scrollToId('all-products')}
              className="store-grocery-pulse inline-flex h-12 items-center gap-2 rounded-full px-6 text-[14px] font-bold transition-transform hover:-translate-y-0.5"
              style={{ backgroundColor: accent, color: onAccent }}
            >
              {theme.hero_cta || 'Shop now'}
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollToId('g-categories')}
              className="inline-flex h-12 items-center rounded-full border-[1.5px] px-6 text-[14px] font-bold transition-colors"
              style={{ borderColor: `color-mix(in srgb, currentColor 22%, transparent)` }}
            >
              Browse categories
            </button>
          </div>
          {stats.length > 0 ? (
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
              {stats.map((s) => (
                <span key={s} className="text-[13px] font-semibold" style={{ opacity: 0.7 }}>
                  {s}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="relative hidden min-h-[300px] items-center justify-center md:flex">
          {slide.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`i-${idx}`}
              src={slide.image_url}
              alt=""
              className="store-grocery-float relative z-10 max-h-[340px] w-full rounded-[24px] object-cover shadow-[0_24px_60px_rgba(21,35,27,0.18)]"
            />
          ) : (
            <div className="relative h-[300px] w-[300px]">
              <div
                className="absolute inset-0 rounded-full"
                style={{ background: `radial-gradient(circle at 35% 30%, #ffffff, color-mix(in srgb, ${accent} 30%, #ffffff))` }}
              />
              <div className="store-grocery-spin absolute -inset-5 rounded-full border-2 border-dashed" style={{ borderColor: `color-mix(in srgb, ${accent} 35%, transparent)` }} />
              <span className="store-grocery-float absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[110px] leading-none">🧺</span>
              {['🥬', '🍎', '🥛', '🥖'].map((e, i) => (
                <span
                  key={e}
                  className="store-grocery-float absolute flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-3xl shadow-[0_12px_35px_rgba(21,35,27,0.12)]"
                  style={{
                    animationDelay: `${i * 0.8}s`,
                    ...[{ left: '-6%', top: '8%' }, { right: '-8%', top: '18%' }, { left: '2%', bottom: '4%' }, { right: '0%', bottom: '10%' }][i],
                  }}
                >
                  {e}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {slides.length > 1 ? (
        <div className="relative z-10 mt-6 flex gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Slide ${i + 1}`}
              onClick={() => setIdx(i)}
              className="h-2 rounded-full transition-all"
              style={{ width: i === idx ? 24 : 8, backgroundColor: i === idx ? accent : `color-mix(in srgb, ${accent} 30%, transparent)` }}
            />
          ))}
        </div>
      ) : null}
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
        style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)` }}
      />
    </div>
  );
}

function SectionHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-[clamp(22px,2.6vw,30px)] font-extrabold tracking-[-0.02em]">{title}</h2>
        {sub ? (
          <p className="mt-1 text-[13px]" style={{ opacity: 0.55 }}>
            {sub}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function StoreGroceryHome({
  store,
  theme,
  paper,
  ink,
  items,
  featuredItems,
  offerItems,
  categories,
  selectedCategory,
  searchQuery,
  total,
  hasMore,
  loading,
  heroSlides,
  onCategory,
  onLoadMore,
  onViewDetail,
}: {
  store: { name: string; store_tagline: string | null; store_about_md: string | null };
  theme: StoreTheme;
  paper: string;
  ink: string;
  items: StoreProduct[];
  featuredItems: StoreProduct[];
  offerItems: StoreProduct[];
  categories: GroceryCategory[];
  selectedCategory: string | null;
  searchQuery: string;
  total: number;
  hasMore: boolean;
  loading: boolean;
  heroSlides: StoreHeroSlide[];
  onCategory: (id: string | null) => void;
  onLoadMore: () => void;
  onViewDetail: (p: StoreProduct) => void;
}) {
  const accent = theme.accent;
  const dark = hexLuminance(paper) < 0.4;
  const home = !searchQuery && !selectedCategory;
  const [sort, setSort] = useState<SortKey>('default');

  const maxOff = useMemo(
    () => offerItems.reduce((m, p) => Math.max(m, storeDiscountPercent(p.mrp, p.selling_price)), 0),
    [offerItems],
  );

  const sorted = useMemo(() => {
    if (sort === 'default') return items;
    const copy = [...items];
    if (sort === 'price-asc') copy.sort((a, b) => a.selling_price - b.selling_price);
    if (sort === 'price-desc') copy.sort((a, b) => b.selling_price - a.selling_price);
    if (sort === 'discount') copy.sort((a, b) => storeDiscountPercent(b.mrp, b.selling_price) - storeDiscountPercent(a.mrp, a.selling_price));
    return copy;
  }, [items, sort]);

  const stats = [
    total > 0 ? `${total.toLocaleString('en-IN')} products` : '',
    categories.length > 0 ? `${categories.length} categories` : '',
    maxOff > 0 ? `Up to ${maxOff}% off today` : '',
  ].filter(Boolean);

  const pickCategory = (id: string | null) => {
    onCategory(id);
    requestAnimationFrame(() => scrollToId('all-products'));
  };

  const promos = useMemo(() => {
    if (theme.overlay_bands.length > 0) {
      return theme.overlay_bands.slice(0, 2).map((b, i) => ({
        eyebrow: i === 0 ? 'Special offer' : 'Featured',
        title: b.caption,
        text: '',
        cta: b.cta || 'Shop now',
        image: b.image_url,
        emoji: groceryCategoryEmoji(categories[i]?.name ?? ''),
      }));
    }
    return [
      {
        eyebrow: "Today's offers",
        title: maxOff > 0 ? `Save up to ${maxOff}% on ${offerItems.length} item${offerItems.length === 1 ? '' : 's'}` : 'Everyday essentials, honest prices',
        text: 'Handpicked deals from our shelves, updated regularly.',
        cta: maxOff > 0 ? 'Shop offers' : 'Shop now',
        image: '',
        emoji: '🏷️',
      },
      {
        eyebrow: store.name,
        title: store.store_tagline || 'Your weekly shop in a few taps',
        text: 'Add to cart, check out, and we will get your order ready.',
        cta: 'Start shopping',
        image: '',
        emoji: groceryCategoryEmoji(categories[0]?.name ?? ''),
      },
    ];
  }, [theme.overlay_bands, categories, maxOff, offerItems.length, store.name, store.store_tagline]);

  const tileBg = dark ? 'rgba(255,255,255,0.05)' : '#ffffff';
  const gridCls = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5';
  const selectedName = selectedCategory ? categories.find((c) => c.id === selectedCategory)?.name : null;

  return (
    <div className="mx-auto max-w-7xl px-4">
      {home && heroSlides.length > 0 ? (
        <div className="pt-5 sm:pt-7">
          <HeroCard slides={heroSlides} theme={theme} dark={dark} stats={stats} storeName={store.name} />
        </div>
      ) : null}

      {home && sectionEnabled(theme, 'categories') && categories.length > 0 ? (
        <Reveal id="g-categories" className="scroll-mt-40 pt-12">
          <SectionHead
            title="Shop by category"
            sub="Find everything you need, aisle by aisle."
            action={
              <button type="button" onClick={() => scrollToId('all-products')} className="hidden items-center gap-1 text-[13px] font-bold sm:inline-flex" style={{ color: accent }}>
                View all <ArrowRight className="h-4 w-4" />
              </button>
            }
          />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 sm:gap-4 lg:grid-cols-6">
            {categories.slice(0, 12).map((c) => {
              const img = theme.category_images[c.id];
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pickCategory(c.id)}
                  className="g-lift g-line flex flex-col items-center rounded-[18px] border px-2 py-4 text-center sm:py-5"
                  style={{ backgroundColor: tileBg }}
                >
                  <span
                    className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl text-[30px] sm:h-16 sm:w-16"
                    style={{ backgroundColor: `color-mix(in srgb, ${accent} 10%, transparent)` }}
                  >
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt="" className="h-full w-full object-cover" />
                    ) : (
                      groceryCategoryEmoji(c.name)
                    )}
                  </span>
                  <span className="mt-3 line-clamp-2 text-[13px] font-bold leading-tight sm:text-[14px]">{c.name}</span>
                  {c.item_count ? (
                    <span className="mt-1 text-[11px]" style={{ opacity: 0.5 }}>
                      {c.item_count} {c.item_count === 1 ? 'product' : 'products'}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </Reveal>
      ) : null}

      {home && sectionEnabled(theme, 'offers') && offerItems.length > 0 ? (
        <Reveal id="g-offers" className="scroll-mt-40 pt-12">
          <SectionHead
            title="Today's deals"
            sub={maxOff > 0 ? `Up to ${maxOff}% off on selected items` : undefined}
          />
          <div className="g-chips -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:gap-4">
            {offerItems.map((item) => (
              <StoreProductCard key={`deal-${item.id}`} product={item} variant="shelf" onViewDetail={onViewDetail} />
            ))}
          </div>
        </Reveal>
      ) : null}

      {home && sectionEnabled(theme, 'overlay') && promos.length > 0 ? (
        <Reveal className="grid gap-4 pt-12 md:grid-cols-2">
          {promos.map((p, i) => {
            const deep = i % 2 === 1;
            return (
              <div
                key={`${p.title}-${i}`}
                className="g-lift group relative min-h-[220px] overflow-hidden rounded-[24px] p-7 sm:p-8"
                style={
                  deep
                    ? { backgroundColor: groceryDeep(accent), color: '#fff' }
                    : { backgroundColor: dark ? `color-mix(in srgb, ${accent} 16%, ${paper})` : `color-mix(in srgb, ${accent} 10%, #ffffff)` }
                }
              >
                <div className="relative z-10 max-w-[62%]">
                  <p className="text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: deep ? '#fbbf24' : accent }}>
                    {p.eyebrow}
                  </p>
                  <h3 className="mt-2 text-[clamp(20px,2.4vw,28px)] font-extrabold leading-tight tracking-[-0.02em]">{p.title}</h3>
                  {p.text ? (
                    <p className="mt-2 text-[13px] leading-relaxed" style={{ opacity: 0.7 }}>
                      {p.text}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => scrollToId(i === 0 && offerItems.length > 0 ? 'g-offers' : 'all-products')}
                    className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-full px-5 text-[13px] font-bold transition-transform hover:-translate-y-0.5"
                    style={deep ? { backgroundColor: '#fbbf24', color: '#172019' } : { backgroundColor: accent, color: chowkOnAccent(accent) }}
                  >
                    {p.cta}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
                {p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.image}
                    alt=""
                    className="absolute bottom-0 right-0 h-full w-[45%] object-cover transition-transform duration-700 group-hover:scale-105"
                    style={{ maskImage: 'linear-gradient(to right, transparent, black 35%)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 35%)' }}
                  />
                ) : (
                  <span
                    className="absolute -bottom-4 right-4 text-[110px] leading-none transition-transform duration-700 group-hover:-rotate-12 group-hover:scale-110 sm:right-8"
                    aria-hidden
                  >
                    {p.emoji}
                  </span>
                )}
              </div>
            );
          })}
        </Reveal>
      ) : null}

      {home && sectionEnabled(theme, 'featured') && featuredItems.length > 0 ? (
        <Reveal className="pt-12">
          <SectionHead title="Featured picks" sub="Chosen by the store" />
          <div className={gridCls}>
            {featuredItems.map((item) => (
              <StoreProductCard key={`feat-${item.id}`} product={item} variant="grid" onViewDetail={onViewDetail} />
            ))}
          </div>
        </Reveal>
      ) : null}

      {home && sectionEnabled(theme, 'product_shelves') ? (
        <StoreProductShelves shelves={theme.product_shelves} onViewDetail={onViewDetail} />
      ) : null}

      {home && sectionEnabled(theme, 'category_shelves')
        ? categories.map((cat) => {
            const row = items.filter((p) => p.category_id === cat.id).slice(0, 10);
            if (row.length === 0) return null;
            return (
              <Reveal key={`shelf-${cat.id}`} className="pt-12">
                <SectionHead
                  title={cat.name}
                  action={
                    <button type="button" onClick={() => pickCategory(cat.id)} className="inline-flex items-center gap-1 text-[13px] font-bold" style={{ color: accent }}>
                      View all <ArrowRight className="h-4 w-4" />
                    </button>
                  }
                />
                <div className="g-chips -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:gap-4">
                  {row.map((item) => (
                    <StoreProductCard key={item.id} product={item} variant="shelf" onViewDetail={onViewDetail} />
                  ))}
                </div>
              </Reveal>
            );
          })
        : null}

      <section id="all-products" className="scroll-mt-40 pt-12">
        <SectionHead
          title={selectedName || (searchQuery ? `Results for “${searchQuery}”` : 'All products')}
          sub={`${total.toLocaleString('en-IN')} ${total === 1 ? 'item' : 'items'}`}
          action={
            items.length > 1 ? (
              <label className="flex items-center gap-2 text-[13px] font-semibold">
                <span className="hidden sm:inline" style={{ opacity: 0.6 }}>
                  Sort
                </span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="g-line h-10 rounded-xl border px-3 text-[13px] font-semibold outline-none"
                  style={{ backgroundColor: tileBg, color: ink }}
                >
                  <option value="default">Recommended</option>
                  <option value="price-asc">Price: low to high</option>
                  <option value="price-desc">Price: high to low</option>
                  <option value="discount">Biggest discount</option>
                </select>
              </label>
            ) : null
          }
        />

        {loading && items.length === 0 ? (
          <div className={gridCls}>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="g-line aspect-[3/4.4] animate-pulse rounded-[18px] border" style={{ backgroundColor: tileBg }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="g-line rounded-[18px] border border-dashed py-14 text-center text-[14px]" style={{ opacity: 0.6 }}>
            {searchQuery ? `No products found for “${searchQuery}”` : 'No products in this store yet.'}
          </div>
        ) : (
          <div className={clsx(gridCls, 'chowk-catalog', loading && 'is-wait')} aria-busy={loading}>
            {sorted.map((item) => (
              <StoreProductCard key={item.id} product={item} variant="grid" onViewDetail={onViewDetail} />
            ))}
          </div>
        )}

        {hasMore ? (
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loading}
              className="inline-flex h-11 min-w-[180px] items-center justify-center rounded-full border-[1.5px] px-6 text-[14px] font-bold transition-colors disabled:opacity-50"
              style={{ borderColor: accent, color: accent }}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : `Load more (${Math.max(0, total - items.length)})`}
            </button>
          </div>
        ) : null}
      </section>

      {home && sectionEnabled(theme, 'testimonials') && theme.testimonials.length > 0 ? (
        <Reveal className="pt-14">
          <SectionHead title="Loved by our customers" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {theme.testimonials.map((tm, i) => (
              <blockquote key={i} className="g-line g-lift rounded-[18px] border p-6" style={{ backgroundColor: tileBg }}>
                <p className="text-[15px] leading-relaxed">“{tm.text}”</p>
                <footer className="mt-4 flex items-center gap-2.5 text-[13px] font-bold">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full text-[12px]" style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
                    {tm.name.slice(0, 1).toUpperCase()}
                  </span>
                  {tm.name}
                </footer>
              </blockquote>
            ))}
          </div>
        </Reveal>
      ) : null}

      {home && sectionEnabled(theme, 'brand_story') && (theme.brand_story || store.store_about_md) ? (
        <Reveal className="pt-14">
          <div className="rounded-[24px] p-8 sm:p-10" style={{ backgroundColor: dark ? `color-mix(in srgb, ${accent} 12%, ${paper})` : `color-mix(in srgb, ${accent} 7%, #ffffff)` }}>
            <p className="text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: accent }}>
              Our story
            </p>
            <p className="mt-3 max-w-3xl whitespace-pre-wrap text-[15px] leading-relaxed" style={{ opacity: 0.8 }}>
              {theme.brand_story || store.store_about_md}
            </p>
          </div>
        </Reveal>
      ) : null}
    </div>
  );
}
