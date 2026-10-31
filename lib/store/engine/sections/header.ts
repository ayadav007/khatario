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
    { id: 'menu', type: 'menu', label: 'Menu', default: 'main' },
    {
      id: 'menu_layout',
      type: 'select',
      label: 'Menu layout',
      default: 'below',
      options: [
        { value: 'below', label: 'Menu below logo' },
        { value: 'inline', label: 'All on one line' },
      ],
    },
    { id: 'menu_caps', type: 'checkbox', label: 'Menu text in capitals', default: false },
    { id: 'show_category_chips', type: 'checkbox', label: 'Category chips', default: false, info: 'A row of category chips under the header' },
  ],
  presets: [
    {
      name: 'Header',
      settings: { show_search: true, icons_position: 'right' },
    },
  ],
  // The chips are optional: a failed category lookup drops only the chips, never the logo, search, cart or menu.
  // Categories always: the Quick preset's header uses them for its pills and search hints.
  data: () => ({ categories: true, categoriesOptional: true }),
};
