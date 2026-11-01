export interface ProductJsonLdInput {
  name: string;
  description: string;
  images: string[];
  sku: string | null;
  brand: string | null;
  price: number;
  inStock: boolean;
  url: string;
}

/** schema.org Product for the product page; empty fields are left out. */
export function productJsonLd(
  p: ProductJsonLdInput,
  rating: { avg: number; count: number } | null,
): Record<string, unknown> {
  const json: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
  };
  if (p.description?.trim()) json.description = p.description.trim();
  const images = (p.images ?? []).filter(Boolean);
  if (images.length) json.image = images;
  if (p.sku) json.sku = p.sku;
  if (p.brand) json.brand = { '@type': 'Brand', name: p.brand };
  json.offers = {
    '@type': 'Offer',
    url: p.url,
    priceCurrency: 'INR',
    price: p.price,
    availability: p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
  };
  if (rating && rating.count > 0) {
    json.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Math.round(rating.avg * 10) / 10,
      reviewCount: rating.count,
    };
  }
  return json;
}
