import type { SectionSchema } from '../schema-types';

/** Reviews (D17): the shared customer-reviews section for the page's product; product template only. */
export const productReviews: SectionSchema = {
  type: 'product-reviews',
  name: 'Reviews',
  category: 'Product page',
  templates: ['product'],
  limit: 1,
  settings: [{ id: 'heading', type: 'text', label: 'Heading', default: 'Reviews', max_length: 120 }],
  presets: [{ name: 'Reviews' }],
};
