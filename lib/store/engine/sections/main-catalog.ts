import type { SectionSchema } from '../schema-types';

/**
 * Product grid (D14, D18): the store's products with filters and sort held in the URL, locked to the
 * route's category on `/catalog/[category]`. Promo tiles are blocks placed after product N.
 */
export const mainCatalog: SectionSchema = {
  type: 'main-catalog',
  name: 'Product grid',
  category: 'Catalog',
  templates: ['catalog'],
  limit: 1,
  settings: [
    { id: 'columns_desktop', type: 'range', label: 'Columns on desktop', min: 2, max: 5, step: 1, default: 4 },
    { id: 'columns_mobile', type: 'range', label: 'Columns on mobile', min: 1, max: 3, step: 1, default: 2 },
    { id: 'show_filters', type: 'checkbox', label: 'Show filters', default: true },
    { id: 'show_sort', type: 'checkbox', label: 'Show sort', default: true },
  ],
  max_blocks: 3,
  blocks: [
    {
      type: 'promo',
      name: 'Promo tile',
      settings: [
        { id: 'image', type: 'image', label: 'Image', default: '' },
        { id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 60 },
        { id: 'text', type: 'text', label: 'Text', default: '', max_length: 120 },
        { id: 'link', type: 'url', label: 'Link', default: '' },
        { id: 'position', type: 'range', label: 'Show after product', min: 1, max: 40, step: 1, default: 6 },
      ],
    },
  ],
  presets: [{ name: 'Product grid' }],
};
