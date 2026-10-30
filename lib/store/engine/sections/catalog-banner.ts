import type { SectionSchema } from '../schema-types';

/** Catalog banner: the catalog page's heading; on a category route the category name replaces it. */
export const catalogBanner: SectionSchema = {
  type: 'catalog-banner',
  name: 'Catalog banner',
  category: 'Catalog',
  templates: ['catalog'],
  limit: 1,
  settings: [
    { id: 'heading', type: 'text', label: 'Heading', default: 'All products', max_length: 80 },
    {
      id: 'use_category_name',
      type: 'checkbox',
      label: 'Use the category name on a category page',
      default: true,
    },
    { id: 'text', type: 'textarea', label: 'Text', default: '', max_length: 300 },
    { id: 'image', type: 'image', label: 'Image', default: '' },
    {
      id: 'height',
      type: 'select',
      label: 'Height',
      default: 'small',
      options: [
        { value: 'small', label: 'Small' },
        { value: 'medium', label: 'Medium' },
      ],
    },
  ],
  presets: [{ name: 'Catalog banner' }],
};
