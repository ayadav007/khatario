import type { SectionSchema } from '../schema-types';
import { CONTENT_BLOCKS } from '../content-blocks';

export const richText: SectionSchema = {
  type: 'rich-text',
  name: 'Rich text',
  category: 'Text',
  templates: ['home', 'product', 'catalog', 'page'],
  settings: [
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
  blocks: CONTENT_BLOCKS,
  max_blocks: 12,
  presets: [
    {
      name: 'Rich text',
      settings: { align: 'center' },
      blocks: [
        { type: 'heading', settings: { text: 'About us' } },
        { type: 'text', settings: { content: '<p>Share your story.</p>' } },
      ],
    },
  ],
};
