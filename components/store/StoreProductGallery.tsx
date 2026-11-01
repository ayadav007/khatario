'use client';

import { ProductGallery } from './features/product/ProductGallery';

/** Kept for existing callers; the gallery itself lives in features/product. */
export function StoreProductGallery({
  images,
  alt,
  accent,
}: {
  images: string[];
  alt: string;
  accent: string;
}) {
  // The theme accent drives the selected thumbnail and dots through --primary.
  return (
    <div style={accent ? ({ ['--primary' as string]: accent } as React.CSSProperties) : undefined}>
      <ProductGallery images={images} alt={alt} />
    </div>
  );
}
