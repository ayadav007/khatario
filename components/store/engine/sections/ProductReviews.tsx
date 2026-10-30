import type { EngineSectionProps } from '../registry';
import { EngineProductReviews } from '../product/ProductSections';
import { withDefaults } from './shared';

/** `product-reviews`: the shared reviews section for the route's product. */
export function ProductReviews({ section, route }: EngineSectionProps) {
  if (!route?.productId) return null;
  const s = withDefaults(section);
  return <EngineProductReviews heading={String(s.heading || 'Reviews')} />;
}
