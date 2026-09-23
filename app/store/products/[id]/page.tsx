'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { StoreShell } from '@/components/store/StoreShell';
import { useStore } from '@/lib/store/store-context';
import type { StoreProduct } from '@/components/store/StoreProductCard';
import { Loader2, Package } from 'lucide-react';

export default function StoreProductPage() {
  const params = useParams<{ id: string }>();
  const { store, addToCart } = useStore();
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!store || !params.id) return;
    (async () => {
      const res = await fetch(
        `/api/public/store/${encodeURIComponent(store.store_subdomain)}/items/${params.id}`,
      );
      if (res.ok) setProduct(await res.json());
      setLoading(false);
    })();
  }, [store, params.id]);

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

  return (
    <StoreShell>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="overflow-hidden rounded-2xl bg-gray-100">
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.image_url} alt="" className="h-80 w-full object-cover" />
          ) : (
            <div className="flex h-80 items-center justify-center">
              <Package className="h-16 w-16 text-gray-300" />
            </div>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{product.name}</h1>
          <p className="mt-2 text-2xl font-bold">
            ₹{product.selling_price.toLocaleString('en-IN')}
          </p>
          {product.description ? (
            <p className="mt-4 whitespace-pre-wrap text-sm text-gray-600">{product.description}</p>
          ) : null}
          <button
            className="mt-6 rounded-xl bg-green-600 px-6 py-3 text-sm font-semibold text-white"
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
            Add to cart
          </button>
        </div>
      </div>
    </StoreShell>
  );
}
