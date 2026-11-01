import type { SectionSchema } from '../schema-types';
import { blockProductIds } from '../block-products';

/** Editorial collage: a text panel beside up to four image, product or category tiles. */
export const collage: SectionSchema = {
  type: 'collage',
  name: 'Collage',
  category: 'Banners',
  templates: ['home', 'page'],
  settings: [
    { id: 'eyebrow', type: 'text', label: 'Eyebrow', default: '', max_length: 60 },
    { id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 120 },
    { id: 'text', type: 'richtext', label: 'Text', default: '' },
    { id: 'button_text', type: 'text', label: 'Button text', default: '', max_length: 30 },
    { id: 'link', type: 'url', label: 'Button link', default: '' },
    { id: 'button_2_text', type: 'text', label: 'Second button text', default: '', max_length: 30 },
    { id: 'link_2', type: 'url', label: 'Second button link', default: '' },
    {
      id: 'layout',
      type: 'select',
      label: 'Layout',
      default: 'text-left',
      options: [
        { value: 'text-left', label: 'Text on the left' },
        { value: 'text-right', label: 'Text on the right' },
        { value: 'tiles', label: 'Tiles only' },
      ],
    },
    {
      id: 'feature_tile',
      type: 'select',
      label: 'Tile sizes',
      default: 'first',
      options: [
        { value: 'first', label: 'First tile larger' },
        { value: 'equal', label: 'All equal' },
      ],
    },
    {
      id: 'tile_shape',
      type: 'select',
      label: 'Tile shape',
      default: 'portrait',
      options: [
        { value: 'portrait', label: 'Portrait' },
        { value: 'square', label: 'Square' },
      ],
    },
  ],
  blocks: [
    {
      type: 'image_tile',
      name: 'Image tile',
      settings: [
        { id: 'image', type: 'image', label: 'Image', default: '', video: true },
        { id: 'caption', type: 'text', label: 'Caption', default: '', max_length: 60 },
        { id: 'label', type: 'text', label: 'Label', default: '', max_length: 30 },
        { id: 'link', type: 'url', label: 'Link', default: '' },
      ],
    },
    {
      type: 'product_tile',
      name: 'Product tile',
      settings: [
        { id: 'product', type: 'product', label: 'Product' },
        { id: 'image', type: 'image', label: 'Image', default: '' },
      ],
    },
    {
      type: 'category_tile',
      name: 'Category tile',
      settings: [
        { id: 'category', type: 'category', label: 'Category' },
        { id: 'image', type: 'image', label: 'Image', default: '' },
      ],
    },
  ],
  max_blocks: 4,
  presets: [
    {
      name: 'Collage',
      settings: { layout: 'text-left', feature_tile: 'first' },
      blocks: [{ type: 'image_tile' }, { type: 'image_tile' }, { type: 'image_tile' }],
    },
  ],
  data: (_settings, blocks) => {
    const productIds = blockProductIds(blocks, 'product_tile');
    return { ...(productIds.length ? { productIds } : {}), categories: true, categoriesOptional: true };
  },
};
