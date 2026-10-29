import type { SectionSchema } from '../schema-types';

export const categoryGrid: SectionSchema = {
  type: 'category-grid',
  name: 'Category grid',
  category: 'Products',
  templates: ['home', 'page'],
  settings: [
    { id: 'heading', type: 'text', label: 'Heading', default: 'Shop by category', max_length: 120 },
    { id: 'eyebrow', type: 'text', label: 'Eyebrow', default: '', max_length: 60 },
    { id: 'columns', type: 'range', label: 'Columns', min: 3, max: 8, step: 1, default: 4 },
    {
      id: 'style',
      type: 'select',
      label: 'Style',
      default: 'tiles',
      options: [
        { value: 'tiles', label: 'Tiles' },
        { value: 'circles', label: 'Circles' },
        { value: 'cards', label: 'Cards' },
      ],
    },
    { id: 'categories', type: 'category_list', label: 'Categories', info: 'Leave empty to show all categories', default: [] },
  ],
  presets: [{ name: 'Category grid', settings: { heading: 'Shop by category', columns: 4, style: 'tiles' } }],
  data: () => ({ categories: true }),
};
