import type { SectionSchema } from '../schema-types';

export const richText: SectionSchema = {
  type: 'rich-text',
  name: 'Rich text',
  category: 'Text',
  templates: ['home', 'product', 'catalog', 'page'],
  settings: [
    { id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 120 },
    { id: 'content', type: 'richtext', label: 'Content', default: '' },
    {
      id: 'align',
      type: 'select',
      label: 'Alignment',
      default: 'center',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ],
    },
  ],
  presets: [{ name: 'Rich text', settings: { heading: 'About us', content: '<p>Share your story.</p>', align: 'center' } }],
};
