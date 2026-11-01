import type { SectionSchema } from '../schema-types';
import { CARD_DESIGN_SETTING } from './featured-products';

/** Recently viewed (D17): products this shopper opened before, as a rail; product template only. */
export const recentlyViewed: SectionSchema = {
  type: 'recently-viewed',
  name: 'Recently viewed',
  category: 'Product page',
  templates: ['product'],
  limit: 1,
  settings: [
    { id: 'heading', type: 'text', label: 'Heading', default: 'Recently viewed', max_length: 120 },
    CARD_DESIGN_SETTING,
  ],
  presets: [{ name: 'Recently viewed' }],
};
