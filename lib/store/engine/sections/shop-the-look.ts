import type { SectionSchema } from '../schema-types';
import { blockProductIds } from '../block-products';

/** One styled image with product hotspots, and a list of the products beside it. */
export const shopTheLook: SectionSchema = {
  type: 'shop-the-look',
  name: 'Shop the look',
  category: 'Products',
  templates: ['home', 'page', 'product'],
  settings: [
    { id: 'eyebrow', type: 'text', label: 'Eyebrow', default: '', max_length: 60 },
    { id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 120 },
    { id: 'text', type: 'textarea', label: 'Text', default: '', max_length: 300 },
    { id: 'image', type: 'image', label: 'Image', default: '' },
    {
      id: 'image_side',
      type: 'select',
      label: 'Image position',
      default: 'left',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
      ],
    },
    { id: 'show_list', type: 'checkbox', label: 'Show product list', default: true },
    { id: 'show_add_all', type: 'checkbox', label: 'Show "Add all to cart"', default: false },
    { id: 'list_heading', type: 'text', label: 'List heading', default: 'In this look', max_length: 60 },
  ],
  blocks: [
    {
      type: 'hotspot',
      name: 'Hotspot',
      settings: [
        { id: 'product', type: 'product', label: 'Product' },
        { id: 'x', type: 'range', label: 'Horizontal position (%)', min: 0, max: 100, step: 1, default: 50 },
        { id: 'y', type: 'range', label: 'Vertical position (%)', min: 0, max: 100, step: 1, default: 50 },
        { id: 'label', type: 'text', label: 'Label', default: '', max_length: 40 },
      ],
    },
  ],
  max_blocks: 6,
  presets: [{ name: 'Shop the look', settings: { show_list: true } }],
  data: (_settings, blocks) => {
    const productIds = blockProductIds(blocks, 'hotspot');
    return productIds.length ? { productIds } : {};
  },
};
