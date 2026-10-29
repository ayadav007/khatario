import type { SectionSchema } from '../schema-types';

export const imageWithText: SectionSchema = {
  type: 'image-with-text',
  name: 'Image with text',
  category: 'Media',
  templates: ['home', 'page', 'product'],
  settings: [
    { id: 'image', type: 'image', label: 'Image', default: '' },
    { id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 120 },
    { id: 'description', type: 'richtext', label: 'Description', default: '' },
    { id: 'button_text', type: 'text', label: 'Button text', default: '', max_length: 30 },
    { id: 'link', type: 'url', label: 'Link', default: '' },
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
  ],
  presets: [
    { name: 'Image with text', settings: { heading: 'Our story', description: '<p>Tell customers about your business.</p>', image_side: 'left' } },
  ],
};
