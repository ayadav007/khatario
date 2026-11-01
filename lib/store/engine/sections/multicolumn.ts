import type { SectionSchema } from '../schema-types';

export const multicolumn: SectionSchema = {
  type: 'multicolumn',
  name: 'Multicolumn',
  category: 'Text',
  templates: ['home', 'page', 'product', 'catalog'],
  settings: [{ id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 120 }],
  blocks: [
    {
      type: 'column',
      name: 'Column',
      limit: 6,
      settings: [
        { id: 'icon', type: 'icon', label: 'Icon', default: 'badge' },
        { id: 'image', type: 'image', label: 'Photo (replaces the icon)', default: '' },
        { id: 'title', type: 'text', label: 'Title', default: '', max_length: 40 },
        { id: 'text', type: 'text', label: 'Text', default: '', max_length: 120 },
      ],
    },
  ],
  max_blocks: 6,
  presets: [
    {
      name: 'Multicolumn',
      blocks: [
        { type: 'column', settings: { icon: 'truck', title: 'Fast delivery', text: 'Delivered to your door' } },
        { type: 'column', settings: { icon: 'shield', title: 'Secure payments', text: 'Safe and easy checkout' } },
        { type: 'column', settings: { icon: 'return', title: 'Easy returns', text: 'Hassle-free returns' } },
      ],
    },
  ],
};
