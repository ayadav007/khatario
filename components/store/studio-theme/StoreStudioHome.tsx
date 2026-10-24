'use client';

import { Loader2 } from 'lucide-react';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { sectionEnabled, type StoreTheme } from '@/lib/store/store-theme';
import type { StudioSection } from '@/lib/store/studio-sections';
import type { StudioLinkTarget } from '@/lib/store/studio-layout';
import { StoreProductCard, type StoreProduct } from '../StoreProductCard';
import { StoreProductShelves } from '../StoreProductShelves';
import {
  StudioBanner,
  StudioCategoriesSection,
  StudioHero,
  StudioProductsSection,
  StudioRichText,
  StudioTestimonials,
} from './StudioSections';

export interface StudioHomeCategory {
  id: string;
  name: string;
  item_count?: number;
}

function scrollToProducts() {
  requestAnimationFrame(() => document.getElementById('all-products')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

export function StoreStudioHome({
  store,
  theme,
  sections,
  items,
  categories,
  selectedCategory,
  offersOnly,
  searchQuery,
  total,
  hasMore,
  loading,
  onCategory,
  onClear,
  onNavigate,
  onLoadMore,
  onViewDetail,
}: {
  store: StoreBusinessContext;
  theme: StoreTheme;
  sections: StudioSection[];
  items: StoreProduct[];
  categories: StudioHomeCategory[];
  selectedCategory: string | null;
  offersOnly: boolean;
  searchQuery: string;
  total: number;
  hasMore: boolean;
  loading: boolean;
  onCategory: (id: string | null) => void;
  onClear: () => void;
  onNavigate: (target: StudioLinkTarget, label: string) => void;
  onLoadMore: () => void;
  onViewDetail: (p: StoreProduct) => void;
}) {
  const browsing = Boolean(searchQuery || selectedCategory || offersOnly);
  const mobileColumns = theme.mobile_columns === 3 ? 3 : 2;
  const productsSection = sections.find((s) => s.type === 'products');
  const productSettings = productsSection?.settings ?? { columns: 5 };
  const offersOn = sectionEnabled(theme, 'offers');

  const categoryImages: Record<string, string> = {};
  for (const c of categories) {
    const img = theme.category_images[c.id] || items.find((p) => p.category_id === c.id && p.image_url)?.image_url;
    if (img) categoryImages[c.id] = img;
  }

  const grid = (
    <>
      {loading && items.length === 0 ? (
        Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" />)
      ) : (
        items.map((item) => <StoreProductCard key={item.id} product={item} onViewDetail={onViewDetail} />)
      )}
    </>
  );

  const after = (
    <>
      {!loading && items.length === 0 ? (
        <div className="empty">
          {searchQuery ? `No products found for “${searchQuery}”` : offersOnly ? 'No offers right now.' : 'No products here yet.'}
        </div>
      ) : null}
      {hasMore ? (
        <div className="loadMore" style={{ marginTop: 0, paddingBottom: 24 }}>
          <button type="button" onClick={onLoadMore} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : `Load more (${Math.max(0, total - items.length)})`}
          </button>
        </div>
      ) : null}
    </>
  );

  if (browsing) {
    const selectedName = selectedCategory ? categories.find((c) => c.id === selectedCategory)?.name : null;
    const title = selectedName || (offersOnly ? 'Offers' : `Results for “${searchQuery}”`);
    return (
      <div className="st-cq">
        <StudioProductsSection
          id="all-products"
          s={{ ...productSettings, eyebrow: '', background: undefined, spacingTop: undefined }}
          title={title}
          count={`${total} ${total === 1 ? 'product' : 'products'}`}
          action={{ label: 'Back to shop', onClick: onClear }}
          mobileColumns={mobileColumns}
          chips={
            categories.length > 0 && sectionEnabled(theme, 'categories') ? (
              <div className="st-chips" role="tablist" aria-label="Categories">
                <button type="button" className={!selectedCategory && !offersOnly ? 'on' : ''} onClick={() => onCategory(null)}>
                  All
                </button>
                {offersOn ? (
                  <button
                    type="button"
                    className={offersOnly ? 'on' : ''}
                    onClick={() => onNavigate({ kind: 'offers' }, 'Offers')}
                  >
                    Offers
                  </button>
                ) : null}
                {categories.map((c) => (
                  <button key={c.id} type="button" className={selectedCategory === c.id ? 'on' : ''} onClick={() => onCategory(c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            ) : null
          }
        >
          {grid}
        </StudioProductsSection>
        {after}
      </div>
    );
  }

  return (
    <div className="st-cq">
      {sections.map((section) => {
        if (!section.enabled) return null;
        const s = section.settings;
        switch (section.type) {
          case 'hero':
            return <StudioHero key={section.id} s={s} onCta={scrollToProducts} />;
          case 'categories':
            if (categories.length === 0) return null;
            return (
              <div key={section.id} id="st-categories">
                <StudioCategoriesSection
                  s={s}
                  categories={categories.slice(0, Math.max(s.columns ?? 6, 6) * 2).map((c) => ({
                    id: c.id,
                    name: c.name,
                    count: c.item_count,
                  }))}
                  style={theme.category_style}
                  images={categoryImages}
                  selectedId={selectedCategory}
                  onSelect={(id) => {
                    onCategory(id);
                    scrollToProducts();
                  }}
                  viewAll={{ label: 'View All', onClick: scrollToProducts }}
                />
              </div>
            );
          case 'products':
            return (
              <div key={section.id}>
                <StudioProductsSection
                  id="all-products"
                  s={s}
                  count={total > 0 ? `${total} ${total === 1 ? 'product' : 'products'}` : undefined}
                  action={null}
                  mobileColumns={mobileColumns}
                >
                  {grid}
                </StudioProductsSection>
                {after}
              </div>
            );
          case 'banner':
            return (
              <StudioBanner
                key={section.id}
                s={s}
                onCta={() => (offersOn ? onNavigate({ kind: 'offers' }, 'Offers') : scrollToProducts())}
              />
            );
          case 'testimonials':
            if (theme.testimonials.length === 0) return null;
            return <StudioTestimonials key={section.id} s={s} testimonials={theme.testimonials} />;
          case 'richtext':
            return <StudioRichText key={section.id} s={s} />;
          default:
            return null;
        }
      })}

      {!productsSection?.enabled ? (
        <StudioProductsSection id="all-products" s={{ eyebrow: '', columns: 5 }} title="All products" action={null} mobileColumns={mobileColumns}>
          {grid}
        </StudioProductsSection>
      ) : null}

      {sectionEnabled(theme, 'product_shelves') ? (
        <StoreProductShelves shelves={theme.product_shelves} onViewDetail={onViewDetail} studio mobileColumns={mobileColumns} />
      ) : null}

      {sectionEnabled(theme, 'brand_story') && (theme.brand_story || store.store_about_md) ? (
        <StudioRichText s={{ title: 'Our story', text: theme.brand_story || store.store_about_md || '' }} />
      ) : null}
    </div>
  );
}
