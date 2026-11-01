import type { EngineSectionProps } from '../registry';
import { CardLookScope } from '../CardLookScope';
import { EngineRecentlyViewed } from '../product/ProductSections';
import { str, withDefaults } from './shared';

/** `recently-viewed`: heading mapped on the server; the list comes from the product provider. */
export function RecentlyViewed({ section, route }: EngineSectionProps) {
  if (!route?.productId) return null;
  const s = withDefaults(section);
  return (
    <CardLookScope design={str(s.card_design)}>
      <EngineRecentlyViewed heading={String(s.heading || 'Recently viewed')} />
    </CardLookScope>
  );
}
