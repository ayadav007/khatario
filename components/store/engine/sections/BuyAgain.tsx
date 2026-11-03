import type { EngineSectionProps } from '../registry';
import { BuyAgainProducts } from './BuyAgainProducts';
import { str, withDefaults } from './shared';

/** `buy-again`: settings mapped on the server; the shopper's own products are fetched in the browser. */
export function BuyAgain({ section, store }: EngineSectionProps) {
  const s = withDefaults(section);
  const max = typeof s.max_items === 'number' ? Math.min(12, Math.max(4, Math.round(s.max_items))) : 8;
  return (
    <BuyAgainProducts
      subdomain={store.store_subdomain}
      demo={!!store.is_demo}
      heading={str(s.heading) || 'Buy again'}
      maxItems={max}
      rail={s.style !== 'grid'}
    />
  );
}
