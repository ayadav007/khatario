import type { SectionSchema } from '../schema-types';

/** Related products (D17): the product's related list as a rail; shown on the product template only. */
export const relatedProducts: SectionSchema = {
  type: 'related-products',
  name: 'Related products',
  category: 'Product page',
  templates: ['product'],
  limit: 1,
  settings: [
    { id: 'heading', type: 'text', label: 'Heading', default: 'You may also like', max_length: 120 },
    { id: 'limit', type: 'range', label: 'Number of products', min: 2, max: 8, step: 1, default: 8 },
  ],
  presets: [{ name: 'Related products' }],
};
