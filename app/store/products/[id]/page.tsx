'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { StoreShell } from '@/components/store/StoreShell';
import { useStore } from '@/lib/store/store-context';
import { ProductReviewsSection } from '@/components/store/features/reviews';
import { resolveItemSeo } from '@/lib/store/item-seo';
import { productJsonLd } from '@/lib/store/product-jsonld';
import { Loader2 } from 'lucide-react';
import { chowkOnAccent, isKhatarioPack, sanitizeStoreTheme, storeCanvas, usesStudioSections } from '@/lib/store/store-theme';
import { StoreKhatarioProductView } from '@/components/store/StoreKhatarioProductView';
import {
  ProductGallery,
  ProductInfoTabs,
  ProductJsonLd,
  RecentlyViewed,
  RelatedProducts,
} from '@/components/store/features/product';
import { ProductInfo } from '@/components/store/features/product/ProductInfo';
import { useProductPage } from '@/components/store/features/product/useProductPage';
import {
  findVariant,
  productOffer,
  toVariantInputs,
  type StoreProductDetail,
} from '@/components/store/features/product/product-view';

/** `product-reviews` section: the shared reviews section, feeding new ratings back to the info column. */
function ProductReviewsSlot({
  product,
  onRated,
}: {
  product: StoreProductDetail;
  onRated: (avg: number, count: number) => void;
}) {
  return <ProductReviewsSection itemId={product.id} onRated={onRated} />;
}

export default function StoreProductPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { store, addToCart, cart, updateCartQuantity, customer, favoriteIds, toggleFavorite, rateProduct } = useStore();
  const { product, related, recent, loading } = useProductPage(store?.store_subdomain, params.id);
  // Choices are tied to the product they were made on, so moving to another product starts clean
  // (a reset effect would run after VariantPicker's preselect and wipe it).
  const [picked, setPicked] = useState<{ productId: string; variantId: string | null } | null>(null);
  const [rated, setRated] = useState<{ productId: string; avg: number; count: number } | null>(null);
  const theme = sanitizeStoreTheme(store?.store_theme);
  const accent = theme.accent;
  const paper = storeCanvas(theme);
  const khatario = isKhatarioPack(theme);

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

  const productId = product?.id ?? null;
  const variantId = picked && picked.productId === productId ? picked.variantId : null;
  const setVariantId = useCallback(
    (id: string | null) => {
      if (productId) setPicked({ productId, variantId: id });
    },
    [productId],
  );
  const rating = rated && rated.productId === productId ? rated : null;
  const onRated = useCallback(
    (avg: number, count: number) => {
      if (productId) setRated({ productId, avg, count });
    },
    [productId],
  );

  const variants = useMemo(() => toVariantInputs(product?.variants), [product?.variants]);
  const variant = findVariant(variants, variantId);
  const needsVariant = !!product?.has_variants && variants.length > 0;

  // Same cart line identity as everywhere else: item id + variant id (none for plain items).
  const cartItem = useMemo(() => {
    if (!product) return null;
    return (
      cart.find((c) => c.itemId === product.id && (needsVariant ? c.variantId === variantId : !c.variantId)) ?? null
    );
  }, [cart, product, needsVariant, variantId]);

  const openProduct = useCallback((id: string) => router.push(`/products/${id}`), [router]);

  const jsonLd = useMemo(() => {
    if (!product || typeof window === 'undefined') return null;
    const images = product.images?.length ? product.images : product.image_url ? [product.image_url] : [];
    const inStock = needsVariant
      ? variants.some((v) => Number(v.current_stock ?? 0) > 0)
      : product.current_stock > 0;
    return productJsonLd(
      {
        name: product.name,
        description: product.description ?? '',
        images,
        sku: product.code,
        brand: product.brand ?? null,
        price: product.selling_price,
        inStock,
        url: window.location.href,
      },
      { avg: product.rating_avg ?? 0, count: product.rating_count ?? 0 },
    );
  }, [product, needsVariant, variants]);

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

  if (khatario) {
    return (
      <StoreShell padded={false} showSearch={false}>
        <StoreKhatarioProductView product={product} />
        {jsonLd ? <ProductJsonLd data={jsonLd} /> : null}
      </StoreShell>
    );
  }

  const gallery = product.images?.length ? product.images : product.image_url ? [product.image_url] : [];
  const offer = productOffer(product, variant, variants.length);
  const favorite = favoriteIds.includes(product.id);
  // Studio and Quick shells already set --primary / --paper; grocery and classic do not.
  const tokens = usesStudioSections(theme)
    ? undefined
    : ({ '--primary': accent, '--on-primary': chowkOnAccent(accent), '--paper': paper } as CSSProperties);

  return (
    <StoreShell>
      <div className="space-y-10" style={tokens}>
        <div className="grid gap-6 md:grid-cols-[55fr_45fr] md:items-start md:gap-10">
          <div className="min-w-0">
            <ProductGallery images={gallery} videoUrl={product.video_url} alt={product.name} thumbs="side" />
          </div>
          <div className="min-w-0 md:sticky md:top-24">
            <ProductInfo
              product={product}
              variantId={variantId}
              onVariantChange={setVariantId}
              quantity={cartItem?.quantity ?? 0}
              onQuantity={(q) => updateCartQuantity(product.id, needsVariant ? variantId ?? undefined : undefined, q)}
              onAdd={() =>
                addToCart({
                  itemId: product.id,
                  variantId: needsVariant ? variant?.id : undefined,
                  name: product.name,
                  variantName: needsVariant ? variant?.variant_name : undefined,
                  price: offer.price,
                  quantity: 1,
                  imageUrl: product.image_url ?? undefined,
                  unit: product.unit,
                  maxStock: offer.stock,
                  taxRate: product.tax_rate,
                })
              }
              inCart={!!cartItem}
              favorite={favorite}
              onToggleFavorite={() => void toggleFavorite(product.id)}
              rating={{
                avg: rating?.avg ?? product.rating_avg ?? 0,
                count: rating?.count ?? product.rating_count ?? 0,
                onRate: customer
                  ? (n) => {
                      void rateProduct(product.id, n).then((next) => {
                        if (next) setRated({ productId: product.id, avg: next.rating_avg, count: next.rating_count });
                      });
                    }
                  : undefined,
              }}
            />
          </div>
        </div>
        <ProductInfoTabs
          description={product.description}
          tabs={product.store_tabs ?? []}
          sizeChart={product.size_chart ?? null}
        />
        <ProductReviewsSlot product={product} onRated={onRated} />
        <RelatedProducts products={related} onOpen={openProduct} />
        <RecentlyViewed products={recent} onOpen={openProduct} />
        {jsonLd ? <ProductJsonLd data={jsonLd} /> : null}
      </div>
    </StoreShell>
  );
}
