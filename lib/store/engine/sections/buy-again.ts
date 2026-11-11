import type { SectionSchema } from '../schema-types';

/**
 * Buy again: the signed-in shopper's own past products (each pack its own card, that pack chosen), fetched in the
 * browser from `/api/public/store/{subdomain}/buy-again`. Shows nothing to a shopper with no orders or no sign-in.
 */
export const buyAgain: SectionSchema = {
  type: 'buy-again',
  name: 'Buy again',
  category: 'Products',
  templates: ['home', 'catalog'],
  settings: [
    { id: 'heading', type: 'text', label: 'Heading', default: 'Buy again', max_length: 60 },
    { id: 'max_items', type: 'range', label: 'Number of products', min: 4, max: 12, step: 1, default: 8 },
    {
      id: 'style',
      type: 'select',
      label: 'Layout',
      default: 'rail',
      options: [
        { value: 'rail', label: 'Rail' },
        { value: 'grid', label: 'Grid' },
      ],
    },
  ],
  presets: [{ name: 'Buy again' }],
};
