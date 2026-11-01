import type { SectionSchema } from '../schema-types';

export const collectionList: SectionSchema = {
  type: 'collection-list',
  name: 'Collection list',
  category: 'Products',
  templates: ['home', 'page'],
  settings: [
    { id: 'heading', type: 'text', label: 'Heading', default: 'Shop by collection', max_length: 80 },
    { id: 'columns', type: 'range', label: 'Columns', min: 2, max: 6, step: 1, default: 4 },
  ],
  blocks: [
    {
      type: 'collection',
      name: 'Collection',
      limit: 12,
      settings: [
        { id: 'category', type: 'category', label: 'Category' },
        { id: 'image', type: 'image', label: 'Image', default: '' },
        { id: 'title', type: 'text', label: 'Title', info: 'Leave empty to use the category name', default: '', max_length: 40 },
      ],
    },
  ],
  max_blocks: 12,
  presets: [{ name: 'Collection list', settings: { heading: 'Shop by collection', columns: 4 }, blocks: [{ type: 'collection' }, { type: 'collection' }] }],
  data: () => ({ categories: true }),
};
