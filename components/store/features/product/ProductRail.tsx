'use client';

import { useId, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  StoreProductCard,
  type StoreProduct,
  type StoreProductCardVariant,
} from '@/components/store/StoreProductCard';

type Props = {
  title: string;
  products: StoreProduct[];
  /** Opens a product (the card calls it for "Choose options" on items with variants). */
  onOpen: (id: string) => void;
  /** Card layout; the card handles add to cart and favourites through the store context. */
  cardVariant?: StoreProductCardVariant;
  /** Optional badge per product, e.g. "Bestseller". */
  highlight?: (product: StoreProduct) => string | undefined;
};

/** Horizontal scroll-snap rail of product cards; renders nothing when empty. */
export function ProductRail({ title, products, onOpen, cardVariant = 'grid', highlight }: Props) {
  const headingId = useId();
  const trackRef = useRef<HTMLUListElement>(null);
  if (!products?.length) return null;

  const scroll = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <section aria-labelledby={headingId} className="py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold text-gray-900">
          {title}
        </h2>
        {products.length > 4 ? (
          <div className="hidden gap-1 lg:flex">
            <button
              type="button"
              aria-label={`Scroll ${title} back`}
              onClick={() => scroll(-1)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-[var(--paper,#fff)] text-gray-700 hover:border-gray-400"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label={`Scroll ${title} forward`}
              onClick={() => scroll(1)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-[var(--paper,#fff)] text-gray-700 hover:border-gray-400"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        ) : null}
      </div>
      <ul
        ref={trackRef}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:mx-0 md:scroll-px-0 md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {products.map((p) => (
          <li
            key={p.id}
            className="w-[calc((100%-1.5rem)/2.2)] shrink-0 snap-start md:w-[calc((100%-2.25rem)/3.3)] lg:w-[calc((100%-3rem)/4.5)] xl:w-[calc((100%-3rem)/5)]"
          >
            <StoreProductCard
              product={p}
              variant={cardVariant}
              highlight={highlight?.(p)}
              onViewDetail={(prod) => onOpen(prod.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

type RailProps = Omit<Props, 'title'> & { title?: string };

export function RelatedProducts({ title = 'You may also like', ...props }: RailProps) {
  return <ProductRail title={title} {...props} />;
}

export function RecentlyViewed({ title = 'Recently viewed', ...props }: RailProps) {
  return <ProductRail title={title} {...props} />;
}
