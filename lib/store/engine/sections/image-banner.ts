import type { SectionSchema } from '../schema-types';

export const imageBanner: SectionSchema = {
  type: 'image-banner',
  name: 'Image banner',
  category: 'Banners',
  templates: ['home', 'page', 'catalog'],
  settings: [
    { id: 'image', type: 'image', label: 'Image', default: '' },
    { id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 120 },
    { id: 'description', type: 'textarea', label: 'Description', default: '', max_length: 300 },
    { id: 'button_text', type: 'text', label: 'Button text', default: 'Shop now', max_length: 30 },
    { id: 'link', type: 'url', label: 'Link', default: '' },
    {
      id: 'height',
      type: 'select',
      label: 'Height',
      default: 'medium',
      options: [
        { value: 'small', label: 'Small' },
        { value: 'medium', label: 'Medium' },
        { value: 'large', label: 'Large' },
      ],
    },
    {
      id: 'text_position',
      type: 'select',
      label: 'Text position',
      default: 'left',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ],
    },
  ],
  presets: [{ name: 'Image banner', settings: { heading: 'New arrivals', button_text: 'Shop now', link: '/' } }],
};
