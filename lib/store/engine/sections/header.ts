import type { SectionSchema } from '../schema-types';

export const header: SectionSchema = {
  type: 'header',
  name: 'Header',
  category: 'Header and footer',
  templates: ['header'],
  limit: 1,
  settings: [
    { id: 'logo_url', type: 'image', label: 'Logo', default: '' },
    { id: 'show_search', type: 'checkbox', label: 'Show search', default: true },
    { id: 'search_placeholder', type: 'text', label: 'Search placeholder', default: 'Search products', max_length: 60 },
    { id: 'delivery_eta', type: 'text', label: 'Delivery estimate', default: '', max_length: 40 },
    {
      id: 'icons_position',
      type: 'select',
      label: 'Icons position',
      default: 'right',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
      ],
    },
    { id: 'show_account', type: 'checkbox', label: 'Show account', default: true },
    { id: 'show_cart', type: 'checkbox', label: 'Show cart', default: true },
    { id: 'show_cart_count', type: 'checkbox', label: 'Show cart count', default: true },
    { id: 'show_category_chips', type: 'checkbox', label: 'Category chips', default: false, info: 'A row of category chips under the header' },
  ],
  blocks: [
    {
      type: 'menu_link',
      name: 'Menu link',
      limit: 12,
      settings: [
        { id: 'label', type: 'text', label: 'Label', default: 'All Products', max_length: 40 },
        { id: 'link', type: 'url', label: 'Link', default: '/' },
        { id: 'highlight', type: 'checkbox', label: 'Highlight', default: false },
      ],
    },
  ],
  max_blocks: 12,
  presets: [
    {
      name: 'Header',
      settings: { show_search: true, icons_position: 'right' },
      blocks: [{ type: 'menu_link', settings: { label: 'All Products', link: '/catalog' } }],
    },
  ],
  // The chips are optional: a failed category lookup drops only the chips, never the logo, search, cart or menu.
  data: (s) => (s.show_category_chips === true ? { categories: true, categoriesOptional: true } : {}),
};
