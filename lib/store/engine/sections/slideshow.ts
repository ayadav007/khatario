import type { SectionSchema } from '../schema-types';

export const slideshow: SectionSchema = {
  type: 'slideshow',
  name: 'Slideshow',
  category: 'Banners',
  templates: ['home', 'page'],
  settings: [
    { id: 'autoplay', type: 'checkbox', label: 'Autoplay', default: true },
    { id: 'speed', type: 'range', label: 'Seconds per slide', min: 3, max: 10, step: 1, default: 5 },
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
      id: 'layout',
      type: 'select',
      label: 'Layout',
      default: 'image-text',
      options: [
        { value: 'full', label: 'Full image' },
        { value: 'image-text', label: 'Image then text' },
        { value: 'text-image', label: 'Text then image' },
      ],
    },
  ],
  blocks: [
    {
      type: 'slide',
      name: 'Slide',
      limit: 6,
      settings: [
        { id: 'image', type: 'image', label: 'Image', default: '' },
        { id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 120 },
        { id: 'description', type: 'textarea', label: 'Description', default: '', max_length: 300 },
        { id: 'button_text', type: 'text', label: 'Button text', default: 'Shop now', max_length: 30 },
        { id: 'link', type: 'url', label: 'Link', default: '' },
      ],
    },
  ],
  max_blocks: 6,
  presets: [
    {
      name: 'Slideshow',
      settings: { autoplay: true, speed: 5 },
      blocks: [{ type: 'slide', settings: { heading: 'Welcome', button_text: 'Shop now', link: '/' } }],
    },
  ],
};
