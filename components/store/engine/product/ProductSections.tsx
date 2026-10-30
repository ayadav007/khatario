'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RecentlyViewed, RelatedProducts } from '@/components/store/features/product';
import { ProductReviewsSection } from '@/components/store/features/reviews';
import { useOptionalEngineProduct } from './EngineProductContext';

/** Studio 2 editor mode: the shell carries `eng-editor` (sections are server components with no editor prop). */
function useEngineEditor(): boolean {
  const [editor, setEditor] = useState(false);
  useEffect(() => setEditor(!!document.querySelector('.eng-root.eng-editor')), []);
  return editor;
}

function Placeholder({ text }: { text: string }) {
  return (
    <p className="py-4 text-center text-[13px]" style={{ opacity: 0.6 }} data-eng-placeholder>
      {text}
    </p>
  );
}

/** Related products rail; nothing outside a product page or when the list is empty (a hint in the editor). */
export function EngineRelatedProducts({ heading, limit }: { heading: string; limit: number }) {
  const state = useOptionalEngineProduct();
  const router = useRouter();
  const editor = useEngineEditor();
  if (!state) return null;
  const products = state.related.slice(0, limit);
  if (!products.length) return editor ? <Placeholder text="Shows once shoppers have related products to browse." /> : null;
  return <RelatedProducts title={heading} products={products} onOpen={(id) => router.push(`/products/${id}`)} />;
}

/** Recently viewed rail; nothing outside a product page or when the shopper has no history (a hint in the editor). */
export function EngineRecentlyViewed({ heading }: { heading: string }) {
  const state = useOptionalEngineProduct();
  const router = useRouter();
  const editor = useEngineEditor();
  if (!state) return null;
  if (!state.recent.length) return editor ? <Placeholder text="Shows once shoppers have viewed other products." /> : null;
  return <RecentlyViewed title={heading} products={state.recent} onOpen={(id) => router.push(`/products/${id}`)} />;
}

/**
 * The shared reviews section for the page's product. It draws its own "Customer reviews" heading,
 * so `heading` labels the region for assistive tech and the editor's section list.
 */
export function EngineProductReviews({ heading }: { heading: string }) {
  const state = useOptionalEngineProduct();
  if (!state?.product) return null;
  return (
    <div role="region" aria-label={heading} className="py-4">
      <ProductReviewsSection itemId={state.product.id} onRated={state.setRated} />
    </div>
  );
}
