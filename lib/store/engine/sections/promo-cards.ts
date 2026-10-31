import type { SectionSchema } from '../schema-types';

/** Category banners: up to four cards, each copy plus an image (split) or a caption over the image (overlay). */
export const promoCards: SectionSchema = {
  type: 'promo-cards',
  name: 'Promo cards',
  category: 'Banners',
  templates: ['home', 'page'],
  settings: [
    { id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 120 },
    {
      id: 'style',
      type: 'select',
      label: 'Style',
      default: 'split',
      options: [
        { value: 'split', label: 'Copy beside image' },
        { value: 'overlay', label: 'Caption over image' },
      ],
    },
    { id: 'columns', type: 'range', label: 'Columns', min: 1, max: 3, step: 1, default: 2 },
  ],
  blocks: [
    {
      type: 'card',
      name: 'Card',
      limit: 4,
      settings: [
        { id: 'eyebrow', type: 'text', label: 'Eyebrow', default: '', max_length: 40 },
        { id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 120 },
        { id: 'text', type: 'textarea', label: 'Text', default: '', max_length: 200 },
        { id: 'button_text', type: 'text', label: 'Button text', default: 'Shop now', max_length: 30 },
        { id: 'link', type: 'url', label: 'Link', default: '#catalog' },
        { id: 'image', type: 'image', label: 'Image', default: '' },
      ],
    },
  ],
  max_blocks: 4,
  presets: [
    {
      name: 'Promo cards',
      settings: { style: 'split', columns: 2 },
      blocks: [
        { type: 'card', settings: { eyebrow: 'Fresh picks', heading: 'Farm-fresh every morning', button_text: 'Shop now' } },
        { type: 'card', settings: { eyebrow: 'Save more', heading: 'Weekly offers', button_text: 'See offers' } },
      ],
    },
  ],
};
