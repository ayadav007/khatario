'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useStore, type StoreCartItem } from '@/lib/store/store-context';
import { productJsonLd } from '@/lib/store/product-jsonld';
import type { StoreVariant, StoreVariantInput } from '@/lib/store/variant-options';
import type { StoreProduct } from '@/components/store/StoreProductCard';
import { ProductJsonLd } from '@/components/store/features/product';
import { useProductPage } from '@/components/store/features/product/useProductPage';
import {
  findVariant,
  productOffer,
  toVariantInputs,
  type ProductOffer,
  type StoreProductDetail,
} from '@/components/store/features/product/product-view';

export interface EngineProductState {
  product: StoreProductDetail | null;
  related: StoreProduct[];
  recent: StoreProduct[];
  loading: boolean;
  error: string | null;
  variantId: string | null;
  setVariantId: (id: string | null) => void;
  variant: StoreVariant | null;
  offer: ProductOffer | null;
  needsVariant: boolean;
  /** The product's rating, or the one a review or star tap just returned. */
  rating: { avg: number; count: number };
  setRated: (avg: number, count: number) => void;
  /** The picker's variant list. */
  variants: StoreVariantInput[];
  /** The cart line for this item and the chosen variant (none for plain items), if any. */
  cartItem: StoreCartItem | null;
  /** Adds one of the current offer to the cart, with the classic page's payload. */
  add: () => void;
  setQuantity: (quantity: number) => void;
}

const EngineProductContext = createContext<EngineProductState | null>(null);

/** The product page state; only valid inside `EngineProductProvider`. */
export function useEngineProduct(): EngineProductState {
  const ctx = useContext(EngineProductContext);
  if (!ctx) throw new Error('useEngineProduct outside EngineProductProvider');
  return ctx;
}

/**
 * Loads the product in the browser (D16) and holds the variant, rating and cart state the
 * `main-product` blocks share, with the classic product page's rules. While loading it shows a
 * spinner, and "Product not found." on an error, in place of the template; header and footer
 * are outside it.
 */
export function EngineProductProvider({
  subdomain,
  productId: routeId,
  children,
}: {
  subdomain: string;
  productId: string;
  children: ReactNode;
}) {
  const { addToCart, cart, updateCartQuantity } = useStore();
  const { product, related, recent, loading, error } = useProductPage(subdomain, routeId);
  // Choices are tied to the product they were made on, so moving to another product starts clean
  // (a reset effect would run after VariantPicker's preselect and wipe it).
  const [picked, setPicked] = useState<{ productId: string; variantId: string | null } | null>(null);
  const [rated, setRatedState] = useState<{ productId: string; avg: number; count: number } | null>(null);

  const productId = product?.id ?? null;
  const variantId = picked && picked.productId === productId ? picked.variantId : null;
  const setVariantId = useCallback(
    (id: string | null) => {
      if (productId) setPicked({ productId, variantId: id });
    },
    [productId],
  );
  const own = rated && rated.productId === productId ? rated : null;
  const setRated = useCallback(
    (avg: number, count: number) => {
      if (productId) setRatedState({ productId, avg, count });
    },
    [productId],
  );

  const variants = useMemo(() => toVariantInputs(product?.variants), [product?.variants]);
  const variant = findVariant(variants, variantId);
  const needsVariant = !!product?.has_variants && variants.length > 0;
  const offer = product ? productOffer(product, variant, variants.length) : null;

  // Same cart line identity as everywhere else: item id + variant id (none for plain items).
  const cartItem = useMemo(() => {
    if (!product) return null;
    return (
      cart.find((c) => c.itemId === product.id && (needsVariant ? c.variantId === variantId : !c.variantId)) ?? null
    );
  }, [cart, product, needsVariant, variantId]);

  const add = useCallback(() => {
    if (!product || !offer) return;
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
    });
  }, [addToCart, product, offer, needsVariant, variant]);

  const setQuantity = useCallback(
    (q: number) => {
      if (product) updateCartQuantity(product.id, needsVariant ? variantId ?? undefined : undefined, q);
    },
    [product, updateCartQuantity, needsVariant, variantId],
  );

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

  const value: EngineProductState = {
    product,
    related,
    recent,
    loading,
    error,
    variantId,
    setVariantId,
    variant,
    offer,
    needsVariant,
    rating: {
      avg: own?.avg ?? product?.rating_avg ?? 0,
      count: own?.count ?? product?.rating_count ?? 0,
    },
    setRated,
    variants,
    cartItem,
    add,
    setQuantity,
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16" data-eng-product="loading">
        <Loader2 className="h-6 w-6 animate-spin opacity-40" aria-label="Loading product" />
      </div>
    );
  }
  if (error || !product) {
    return (
      <p className="py-12 text-center text-sm opacity-60" data-eng-product="not-found">
        Product not found.
      </p>
    );
  }

  return (
    <EngineProductContext.Provider value={value}>
      {children}
      {jsonLd ? <ProductJsonLd data={jsonLd} /> : null}
    </EngineProductContext.Provider>
  );
}
