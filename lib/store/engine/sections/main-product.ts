import type { SectionSchema } from '../schema-types';

/**
 * Product information (D17): the gallery plus the info column's blocks, which the merchant orders.
 * The product itself comes from the page's route, loaded in the browser (D16).
 */
export const mainProduct: SectionSchema = {
  type: 'main-product',
  name: 'Product information',
  category: 'Product page',
  templates: ['product'],
  limit: 1,
  settings: [
    {
      id: 'gallery_position',
      type: 'select',
      label: 'Gallery position',
      default: 'left',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
      ],
    },
    {
      id: 'thumbs',
      type: 'select',
      label: 'Thumbnails',
      default: 'side',
      options: [
        { value: 'side', label: 'Beside the image' },
        { value: 'bottom', label: 'Below the image' },
        { value: 'grid', label: 'Photos in a grid' },
      ],
    },
    { id: 'sticky_info', type: 'checkbox', label: 'Keep product info in view while scrolling', default: true },
    { id: 'sticky_buy_bar', type: 'checkbox', label: 'Show an Add to bag bar on phones', default: false },
  ],
  blocks: [
    {
      type: 'title',
      name: 'Title',
      limit: 1,
      settings: [
        { id: 'show_brand', type: 'checkbox', label: 'Show brand', default: true },
        { id: 'show_meta', type: 'checkbox', label: 'Show category and unit', default: true },
        { id: 'show_rating', type: 'checkbox', label: 'Show rating', default: true },
        { id: 'show_tagline', type: 'checkbox', label: 'Show tagline', default: false },
      ],
    },
    {
      type: 'price',
      name: 'Price',
      limit: 1,
      settings: [{ id: 'show_tax_note', type: 'checkbox', label: 'Show GST note', default: true }],
    },
    {
      type: 'variant_picker',
      name: 'Options',
      limit: 1,
      settings: [
        {
          id: 'style',
          type: 'select',
          label: 'Option style',
          default: 'buttons',
          options: [
            { value: 'buttons', label: 'Buttons' },
            { value: 'tiles', label: 'Tiles with price' },
          ],
          info: 'Tiles show each pack with its price. They apply to products with one option (a size or weight).',
        },
        {
          id: 'low_stock_at',
          type: 'range',
          label: 'Show "Only N left" at',
          min: 0,
          max: 10,
          step: 1,
          default: 0,
          info: '0 hides it',
        },
      ],
    },
    {
      type: 'buy_buttons',
      name: 'Buy buttons',
      limit: 1,
      settings: [{ id: 'show_wishlist', type: 'checkbox', label: 'Show wishlist button', default: true }],
    },
    { type: 'description', name: 'Description', limit: 1, settings: [] },
    {
      type: 'collapsible_tab',
      name: 'Collapsible tab',
      settings: [
        { id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 60 },
        { id: 'content', type: 'richtext', label: 'Content', default: '' },
      ],
    },
    {
      type: 'delivery_estimate',
      name: 'Delivery estimate',
      limit: 1,
      settings: [{ id: 'text', type: 'text', label: 'Text', default: 'Delivered in 1–2 days', max_length: 80 }],
    },
    {
      type: 'delivery_check',
      name: 'Delivery check',
      limit: 1,
      settings: [
        { id: 'heading', type: 'text', label: 'Heading', default: 'Check delivery', max_length: 40 },
        { id: 'button_label', type: 'text', label: 'Button label', default: 'Check', max_length: 20 },
      ],
    },
    {
      type: 'share',
      name: 'Share',
      limit: 1,
      settings: [{ id: 'label', type: 'text', label: 'Label', default: 'Share', max_length: 30 }],
    },
    {
      type: 'custom_text',
      name: 'Text',
      settings: [{ id: 'text', type: 'richtext', label: 'Text', default: '' }],
    },
  ],
  presets: [
    {
      name: 'Product information',
      blocks: [
        { type: 'title' },
        { type: 'price' },
        { type: 'variant_picker' },
        { type: 'buy_buttons' },
        { type: 'description' },
      ],
    },
  ],
};
