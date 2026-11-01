import type { SectionSchema } from '../schema-types';

export const header: SectionSchema = {
  type: 'header',
  name: 'Header',
  category: 'Header and footer',
  templates: ['header'],
  limit: 1,
  settings: [
    { id: 'logo_url', type: 'image', label: 'Logo', default: '' },
    {
      id: 'show_store_name',
      type: 'checkbox',
      label: 'Show store name beside the logo',
      default: true,
      info: 'The name always shows when there is no logo. The Quick header shows the logo only.',
    },
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
    { id: 'layout_header', type: 'header', label: 'Layout' },
    {
      id: 'logo_position',
      type: 'select',
      label: 'Logo position',
      info: 'With a centred logo the icons sit on the right',
      default: 'left',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Centre' },
      ],
    },
    {
      id: 'logo_position_mobile',
      type: 'select',
      label: 'Logo position on phones',
      default: 'left',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Centre' },
      ],
    },
    { id: 'logo_width', type: 'range', label: 'Logo size', min: 0, max: 300, step: 10, default: 0, info: "0 keeps the logo's automatic size" },
    { id: 'logo_width_mobile', type: 'range', label: 'Logo size on phones', min: 0, max: 200, step: 10, default: 0, info: "0 keeps the logo's automatic size" },
    {
      id: 'sticky',
      type: 'select',
      label: 'Stay at top while scrolling',
      info: 'Quick stores keep their logo size',
      default: 'always',
      options: [
        { value: 'none', label: "Doesn't stay" },
        { value: 'scroll_up', label: 'Comes back when scrolling up' },
        { value: 'always', label: 'Always stays' },
        { value: 'always_shrink', label: 'Always stays, logo shrinks' },
      ],
    },
    {
      id: 'separator',
      type: 'checkbox',
      label: 'Line under the header',
      info: 'The line between the logo row and the menu row (when the menu is below the logo)',
      default: true,
    },
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
