import type { EngineSectionProps } from '../registry';
import { EngineRecentlyViewed } from '../product/ProductSections';
import { withDefaults } from './shared';

/** `recently-viewed`: heading mapped on the server; the list comes from the product provider. */
export function RecentlyViewed({ section, route }: EngineSectionProps) {
  if (!route?.productId) return null;
  const s = withDefaults(section);
  return <EngineRecentlyViewed heading={String(s.heading || 'Recently viewed')} />;
}
