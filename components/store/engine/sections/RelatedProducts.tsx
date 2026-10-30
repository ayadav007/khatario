import type { EngineSectionProps } from '../registry';
import { EngineRelatedProducts } from '../product/ProductSections';
import { withDefaults } from './shared';

/** `related-products`: heading and limit mapped on the server; the list comes from the product provider. */
export function RelatedProducts({ section, route }: EngineSectionProps) {
  if (!route?.productId) return null;
  const s = withDefaults(section);
  const limit = typeof s.limit === 'number' ? Math.min(8, Math.max(2, s.limit)) : 8;
  return <EngineRelatedProducts heading={String(s.heading || 'You may also like')} limit={limit} />;
}
