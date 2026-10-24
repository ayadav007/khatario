'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { StoreShell } from '@/components/store/StoreShell';
import { useStore, withStoreDraft } from '@/lib/store/store-context';
import { resolveItemSeo } from '@/lib/store/item-seo';
import type { StoreProduct } from '@/components/store/StoreProductCard';
import { Heart, Loader2, Package, Minus, Plus } from 'lucide-react';
import { isKhatarioPack, chowkInkOn, chowkOnAccent, sanitizeStoreTheme, storeCanvas } from '@/lib/store/store-theme';
import { StoreKhatarioProductView } from '@/components/store/StoreKhatarioProductView';
import { StoreProductGallery } from '@/components/store/StoreProductGallery';
import { StoreStars } from '@/components/store/StoreStars';
import clsx from 'clsx';

export default function StoreProductPage() {
  const params = useParams<{ id: string }>();
  const { store, addToCart, cart, updateCartQuantity, customer, favoriteIds, toggleFavorite, rateProduct } = useStore();
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const theme = sanitizeStoreTheme(store?.store_theme);
  const accent = theme.accent;
  const paper = storeCanvas(theme);
  const khatario = isKhatarioPack(theme);
  const grocery = theme.pack === 'grocery';
  const ink = chowkInkOn(paper);

  useEffect(() => {
    if (!store || !params.id) return;
    (async () => {
      const res = await fetch(
        `/api/public/store/${encodeURIComponent(store.store_subdomain)}/items/${params.id}?${withStoreDraft(new URLSearchParams())}`,
      );
      if (res.ok) setProduct(await res.json());
      setLoading(false);
    })();
  }, [store, params.id]);

  useEffect(() => {
    if (!product) return;
    const seo = resolveItemSeo(product);
    document.title = seo.title;
    const ensure = (attr: string, key: string, value: string) => {
      if (!value) return;
      let el = document.head.querySelector(`meta[${attr}="${key}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', value);
    };
    ensure('name', 'description', seo.description);
    ensure('property', 'og:title', seo.title);
    ensure('property', 'og:description', seo.description);
    if (seo.image) ensure('property', 'og:image', seo.image);
  }, [product]);

  const cartItem = useMemo(() => {
    if (!product) return null;
    return cart.find((c) => c.itemId === product.id && !c.variantId) ?? null;
  }, [cart, product]);

  if (loading) {
    return (
      <StoreShell>
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </StoreShell>
    );
  }

  if (!product) {
    return (
      <StoreShell>
        <p className="py-12 text-center text-sm text-gray-500">Product not found.</p>
      </StoreShell>
    );
  }

  const discount =
    product.mrp && product.mrp > product.selling_price
      ? Math.round(((product.mrp - product.selling_price) / product.mrp) * 100)
      : 0;
  const outOfStock = product.current_stock <= 0 && !product.has_variants;

  if (khatario) {
    return (
      <StoreShell padded={false} showSearch={false}>
        <StoreKhatarioProductView product={product} />
      </StoreShell>
    );
  }

  const gallery = product.images?.length ? product.images : product.image_url ? [product.image_url] : [];

  return (
    <StoreShell>
      <div className="grid gap-8 md:grid-cols-2">
        <div
          className={clsx(
            'relative overflow-hidden border',
            grocery ? 'g-line rounded-[1.75rem] bg-white' : 'rounded-[10px]',
          )}
          style={grocery ? undefined : { backgroundColor: 'var(--st-card)', borderColor: 'var(--st-line)' }}
        >
          {gallery.length ? (
            <StoreProductGallery images={gallery} alt={product.name} accent={accent} />
          ) : (
            <div className="flex h-72 items-center justify-center md:h-96">
              <Package className="h-16 w-16 text-gray-300" />
            </div>
          )}
          <button
            type="button"
            className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-sm"
            aria-label={favoriteIds.includes(product.id) ? 'Remove from favourites' : 'Save to favourites'}
            onClick={() => void toggleFavorite(product.id)}
          >
            <Heart
              className="h-5 w-5"
              style={{
                color: favoriteIds.includes(product.id) ? accent : '#6b7280',
                fill: favoriteIds.includes(product.id) ? accent : 'transparent',
              }}
            />
          </button>
          {discount > 0 ? (
            <span
              className={clsx('absolute left-3 top-3 px-2 py-1 text-xs font-bold', grocery ? 'rounded-full bg-amber-400 px-2.5 text-[#172019]' : 'rounded-md text-white')}
              style={grocery ? undefined : { backgroundColor: accent }}
            >
              {discount}% OFF
            </span>
          ) : null}
        </div>
        <div>
          <h1
            className={
              grocery
                ? 'text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl'
                : 'st-serif text-3xl font-bold leading-tight sm:text-4xl'
            }
            style={{ color: ink }}
          >
            {product.name}
          </h1>
          {product.category_name ? (
            <p className="mt-1 text-sm text-gray-500">{product.category_name}</p>
          ) : null}
          <p className="mt-1 text-sm text-gray-400">{product.unit}</p>
          <div className="mt-2">
            <StoreStars
              value={product.rating_avg ?? 0}
              count={product.rating_count}
              size="md"
              onRate={
                customer
                  ? (n) => {
                      void rateProduct(product.id, n);
                    }
                  : undefined
              }
            />
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <p
              className={clsx('text-3xl tabular-nums', grocery ? 'font-extrabold' : 'font-bold')}
              style={{ color: grocery ? accent : ink }}
            >
              ₹{product.selling_price.toLocaleString('en-IN')}
            </p>
            {product.mrp && product.mrp > product.selling_price ? (
              <p className="text-sm text-gray-400 line-through">
                ₹{product.mrp.toLocaleString('en-IN')}
              </p>
            ) : null}
          </div>
          {product.tax_rate > 0 ? (
            <p className="mt-1 text-xs text-gray-500">
              GST {product.tax_rate}%{product.gst_included ? ' included' : ' extra'}
            </p>
          ) : null}
          <p className="mt-2 text-sm text-gray-600">
            {outOfStock ? 'Out of stock' : 'In stock'}
          </p>
          {product.description ? (
            <p className="mt-4 whitespace-pre-wrap text-sm text-gray-600">{product.description}</p>
          ) : null}

          {outOfStock ? null : cartItem && !product.has_variants ? (
            <div
              className={clsx('mt-6 inline-flex items-center', grocery ? 'rounded-2xl' : 'rounded-md')}
              style={{ border: `1px solid color-mix(in srgb, ${ink} 20%, transparent)` }}
            >
              <button
                type="button"
                className="flex h-12 w-12 items-center justify-center"
                aria-label="Decrease quantity"
                onClick={() => updateCartQuantity(product.id, undefined, cartItem.quantity - 1)}
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-[2rem] text-center font-medium tabular-nums" aria-live="polite">
                {cartItem.quantity}
              </span>
              <button
                type="button"
                className="flex h-12 w-12 items-center justify-center"
                aria-label="Increase quantity"
                onClick={() => updateCartQuantity(product.id, undefined, cartItem.quantity + 1)}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={clsx(
                'mt-6 min-h-12 px-6 py-3 text-sm',
                grocery ? 'store-grocery-pulse w-full rounded-2xl font-bold sm:w-auto sm:px-10' : 'rounded-md font-semibold sm:px-10',
              )}
              style={{ backgroundColor: accent, color: chowkOnAccent(accent) }}
              onClick={() =>
                addToCart({
                  itemId: product.id,
                  name: product.name,
                  price: product.selling_price,
                  quantity: 1,
                  imageUrl: product.image_url ?? undefined,
                  unit: product.unit,
                  maxStock: product.current_stock,
                  taxRate: product.tax_rate,
                })
              }
            >
              {product.has_variants ? 'Choose options on home' : 'Add to cart'}
            </button>
          )}
        </div>
      </div>
    </StoreShell>
  );
}
