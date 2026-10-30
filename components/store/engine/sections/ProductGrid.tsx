import { productSectionSettings } from '@/lib/store/engine/studio-adapter';
import type { EngineSectionProps } from '../registry';
import { EngineProductGrid } from '../EngineViews';
import { noBox } from './shared';

/** `featured-products` (grid) and `product-rail` (carousel the phone kit turns into a swipe row). */
export function ProductGrid({ id, section, data }: EngineSectionProps) {
  if (!data || data.error) return null;
  const products = data.products ?? [];
  const isRow = section.type === 'product-rail';
  const s = noBox(productSectionSettings(section));
  // The all-products grid stays mounted when a filter empties it, so the shopper can clear the filter.
  if (products.length === 0 && !(s.source === 'all' && !isRow)) return null;
  return <EngineProductGrid sectionId={id} s={s} products={products} isRow={isRow} />;
}
