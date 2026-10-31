import type { SectionSchema } from '../schema-types';
import { CONTENT_BLOCKS, HIGHLIGHT_CARD_BLOCK } from '../content-blocks';

export const imageWithText: SectionSchema = {
  type: 'image-with-text',
  name: 'Image with text',
  category: 'Media',
  templates: ['home', 'page', 'product'],
  settings: [
    { id: 'image', type: 'image', label: 'Image', default: '' },
    {
      id: 'image_side',
      type: 'select',
      label: 'Image side',
      default: 'left',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
      ],
    },
    {
      id: 'image_width',
      type: 'select',
      label: 'Image width',
      default: 'half',
      options: [
        { value: 'half', label: 'Half' },
        { value: 'narrow', label: 'Narrow' },
      ],
    },
    {
      id: 'text_align',
      type: 'select',
      label: 'Text alignment',
      default: 'left',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
      ],
    },
  ],
  blocks: [...CONTENT_BLOCKS, HIGHLIGHT_CARD_BLOCK],
  max_blocks: 12,
  presets: [
    {
      name: 'Image with text',
      settings: { image_side: 'left' },
      blocks: [
        { type: 'heading', settings: { text: 'Our story' } },
        { type: 'text', settings: { content: '<p>Tell customers about your business.</p>' } },
      ],
    },
  ],
};
