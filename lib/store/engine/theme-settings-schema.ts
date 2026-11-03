// Client-safe: types and the product card's defaults and design names. Defaults match presets/shared.ts.
import type { SettingSchema } from './schema-types';
import type { ThemePreset } from './types';
import { CARD_DESIGN_IDS, CARD_DESIGN_LABELS, PRODUCT_CARD_DEFAULTS as CARD } from './product-card';

type Option = { value: string; label: string };
const opts = (...pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));
const SIZES = opts(['s', 'Small'], ['m', 'Medium'], ['l', 'Large']);

/**
 * Theme settings → Product cards (spec §2 groups). The editor draws `product_card.design` as the current design's name
 * with a "Choose a card design" button (the gallery), not as this select; the options list the values it takes.
 */
export const PRODUCT_CARD_SETTINGS: SettingSchema[] = [
  { id: 'product_card_header', type: 'header', label: 'Product cards' },
  {
    id: 'product_card.design',
    type: 'select',
    label: 'Card design',
    default: CARD.design,
    options: (['theme', ...CARD_DESIGN_IDS] as const).map((id) => ({ value: id, label: CARD_DESIGN_LABELS[id] })),
  },
  { id: 'product_card_lines_header', type: 'header', label: 'Lines' },
  {
    id: 'product_card.lines',
    type: 'line_list',
    label: 'Lines on the card',
    default: CARD.lines.map((l) => ({ ...l })),
    options: opts(
      ['brand', 'Brand'],
      ['name', 'Name'],
      ['unit', 'Unit or pack size'],
      ['rating', 'Rating'],
      ['tagline', 'Tagline'],
      ['price', 'Price'],
      ['sizes', 'Sizes'],
      ['swatches', 'Colour swatches'],
      ['buttons', 'Buttons'],
    ),
    info: 'A line shows only when the product has it.',
  },
  {
    id: 'product_card.name_price_row',
    type: 'checkbox',
    label: 'Name and price on one line',
    default: CARD.name_price_row,
    info: 'Moves the price up next to the name, wherever Price is in the list',
  },
  { id: 'product_card.name_font', type: 'select', label: 'Name font', default: CARD.name_font, options: opts(['heading', 'Heading font'], ['body', 'Body font']) },
  { id: 'product_card.name_case', type: 'select', label: 'Name letters', default: CARD.name_case, options: opts(['normal', 'As typed'], ['caps', 'All capitals']) },
  { id: 'product_card.name_lines', type: 'select', label: 'Name length', default: CARD.name_lines, options: opts(['1', 'One line'], ['2', 'Up to two lines']) },
  { id: 'product_card.name_size', type: 'select', label: 'Name size', default: CARD.name_size, options: SIZES },
  {
    id: 'product_card.rating_style',
    type: 'select',
    label: 'Rating',
    default: CARD.rating_style,
    options: opts(['stars', 'Stars'], ['number', 'Number (★ 4.5)'], ['count', 'Stars and number of reviews']),
  },
  { id: 'product_card_price_header', type: 'header', label: 'Price' },
  { id: 'product_card.price_size', type: 'select', label: 'Price size', default: CARD.price_size, options: SIZES },
  { id: 'product_card.price_color', type: 'select', label: 'Price colour', default: CARD.price_color, options: opts(['text', 'Text colour'], ['accent', 'Accent colour']) },
  { id: 'product_card.show_mrp', type: 'checkbox', label: 'Show the MRP crossed out', default: CARD.show_mrp },
  {
    id: 'product_card.discount_style',
    type: 'select',
    label: 'Discount',
    default: CARD.discount_style,
    options: opts(['none', 'Don’t show'], ['text', '20% off'], ['pill', '20% off in a pill'], ['save', 'Save ₹20']),
  },
  {
    id: 'product_card.unit_price',
    type: 'checkbox',
    label: 'Show price per kg or litre',
    default: CARD.unit_price,
    info: 'Only when the pack is a plain weight or volume, such as 500 g or 1 L',
  },
  { id: 'product_card_photo_header', type: 'header', label: 'Photo' },
  {
    id: 'product_card.image_shape',
    type: 'select',
    label: 'Photo shape',
    default: CARD.image_shape,
    options: opts(['square', 'Square'], ['portrait', 'Tall'], ['landscape', 'Wide'], ['natural', 'The photo’s own shape']),
  },
  {
    id: 'product_card.image_fit',
    type: 'select',
    label: 'Photo fit',
    default: CARD.image_fit,
    options: opts(['fill', 'Fill the space (may crop)'], ['contain', 'Show the whole photo']),
  },
  { id: 'product_card.image_padding', type: 'range', label: 'Space around the photo', min: 0, max: 24, step: 1, default: CARD.image_padding },
  { id: 'product_card.image_radius', type: 'range', label: 'Photo corner radius', min: 0, max: 32, step: 1, default: CARD.image_radius },
  { id: 'product_card.image_bg', type: 'color', label: 'Photo background', default: CARD.image_bg, info: 'Empty: nothing behind the photo' },
  {
    id: 'product_card.image_hover',
    type: 'select',
    label: 'Photo on hover',
    default: CARD.image_hover,
    options: opts(['none', 'Nothing'], ['second', 'Show the second photo'], ['zoom', 'Zoom in']),
  },
  { id: 'product_card.image_swipe', type: 'checkbox', label: 'Swipe between photos, with dots', default: CARD.image_swipe },
  {
    id: 'product_card.placeholder',
    type: 'select',
    label: 'When there is no photo',
    default: CARD.placeholder,
    options: opts(['initial', 'First letter of the name'], ['logo', 'Store logo'], ['icon', 'A picture icon']),
  },
  { id: 'product_card_badges_header', type: 'header', label: 'Badges' },
  { id: 'product_card.badge_shape', type: 'select', label: 'Badge shape', default: CARD.badge_shape, options: opts(['pill', 'Pill'], ['ribbon', 'Ribbon'], ['corner', 'Corner tag']) },
  { id: 'product_card.badge_position', type: 'select', label: 'Badge position', default: CARD.badge_position, options: opts(['top-left', 'Top left'], ['top-right', 'Top right']) },
  {
    id: 'product_card.badge_icon',
    type: 'select',
    label: 'Badge icon',
    default: CARD.badge_icon,
    options: opts(['none', 'None'], ['crown', 'Crown'], ['star', 'Star'], ['flame', 'Flame'], ['sparkle', 'Sparkle']),
  },
  { id: 'product_card.badge_colors', type: 'select', label: 'Badge colours', default: CARD.badge_colors, options: opts(['accent', 'Accent colour'], ['button', 'Button colours']) },
  {
    id: 'product_card.discount_badge',
    type: 'select',
    label: 'Savings badge',
    default: CARD.discount_badge,
    options: opts(['percent', '14% OFF'], ['rupees', '₹91 OFF']),
  },
  { id: 'product_card_buttons_header', type: 'header', label: 'Buttons' },
  {
    id: 'product_card.button_style',
    type: 'select',
    label: 'Button style',
    default: CARD.button_style,
    options: opts(
      ['full', 'Full-width button'],
      ['pill_on_photo', 'Small button on the photo'],
      ['icon', 'Icon button'],
      ['icon_full', 'Full-width button and an icon'],
      ['none', 'No button'],
    ),
  },
  { id: 'product_card.button_fill', type: 'select', label: 'Button colour', default: CARD.button_fill, options: opts(['filled', 'Filled'], ['outline', 'Outline']) },
  { id: 'product_card.button_shape', type: 'select', label: 'Button shape', default: CARD.button_shape, options: opts(['rounded', 'Rounded'], ['pill', 'Pill']) },
  {
    id: 'product_card.button_reveal',
    type: 'select',
    label: 'Show the button',
    default: CARD.button_reveal,
    options: opts(['always', 'Always'], ['hover', 'On hover (always on phones)']),
  },
  {
    id: 'product_card.button_action',
    type: 'select',
    label: 'The button',
    default: CARD.button_action,
    options: opts(['add', 'Adds to cart'], ['buy', 'Buys now']),
    info: 'With a button and an icon, the icon does the other.',
  },
  {
    id: 'product_card.after_add',
    type: 'select',
    label: 'After adding',
    default: CARD.after_add,
    options: opts(['button', 'Keep the button'], ['stepper', 'Show − 1 +']),
  },
  {
    id: 'product_card.wishlist',
    type: 'select',
    label: 'Heart (wishlist)',
    default: CARD.wishlist,
    options: opts(['off', 'Don’t show'], ['top-left', 'Top left'], ['top-right', 'Top right']),
  },
  { id: 'product_card.wishlist_bg', type: 'select', label: 'Heart background', default: CARD.wishlist_bg, options: opts(['plain', 'None'], ['circle', 'White circle']) },
  { id: 'product_card_card_header', type: 'header', label: 'Card' },
  {
    id: 'product_card.layout',
    type: 'select',
    label: 'Layout',
    default: CARD.layout,
    options: opts(['stack', 'Photo on top'], ['row', 'Photo left, details right']),
  },
  { id: 'product_card.color_scheme', type: 'color_scheme', label: 'Card colours', default: CARD.color_scheme, info: 'Default: the section’s colours.' },
  { id: 'product_card.border', type: 'range', label: 'Border', min: 0, max: 3, step: 1, default: CARD.border },
  { id: 'product_card.radius', type: 'range', label: 'Corner radius', min: 0, max: 32, step: 1, default: CARD.radius },
  { id: 'product_card.shadow', type: 'select', label: 'Shadow', default: CARD.shadow, options: opts(['none', 'None'], ['soft', 'Soft'], ['strong', 'Strong']) },
  { id: 'product_card.align', type: 'select', label: 'Text alignment', default: CARD.align, options: opts(['left', 'Left'], ['center', 'Centre']) },
  { id: 'product_card.padding', type: 'range', label: 'Space inside the card', min: 0, max: 24, step: 1, default: CARD.padding },
  { id: 'product_card.background_image', type: 'image', label: 'Background picture', default: CARD.background_image, info: 'Behind the details, under the photo' },
  { id: 'product_card.hover', type: 'select', label: 'Card on hover', default: CARD.hover, options: opts(['none', 'Nothing'], ['lift', 'Lift'], ['zoom', 'Zoom']) },
  { id: 'product_card_oos_header', type: 'header', label: 'Out of stock' },
  {
    id: 'product_card.oos_look',
    type: 'select',
    label: 'Look',
    default: CARD.oos_look,
    options: opts(['label', 'An “Out of stock” label'], ['faded', 'Faded card'], ['soldout_button', 'A “Sold out” button']),
  },
  {
    id: 'product_card.oos_place',
    type: 'select',
    label: 'Place in product lists',
    default: CARD.oos_place,
    options: opts(['stay', 'Where they are'], ['end', 'At the end'], ['hide', 'Hidden']),
    info: 'Applies with any design. A hidden product’s own page still opens.',
  },
];

/** Product card rows that still apply under Theme's own: the design itself and where out-of-stock products sit. */
export const CARD_ROWS_UNDER_THEME: readonly string[] = ['product_card_header', 'product_card.design', 'product_card_oos_header', 'product_card.oos_place'];

export const THEME_SETTINGS_SCHEMA: SettingSchema[] = [
  { id: 'font_heading', type: 'font', label: 'Heading font', default: 'outfit' },
  { id: 'font_body', type: 'font', label: 'Body font', default: 'inter' },
  { id: 'button_radius', type: 'range', label: 'Button corner radius', min: 0, max: 32, step: 1, default: 10 },
  {
    id: 'card_style',
    type: 'select',
    label: 'Card style',
    info: 'Product grid and rail sections keep their own card style',
    default: 'bordered',
    options: [
      { value: 'plain', label: 'Plain' },
      { value: 'bordered', label: 'Bordered' },
      { value: 'shadow', label: 'Shadow' },
    ],
  },
  { id: 'style_header', type: 'header', label: 'Style' },
  {
    id: 'label_style',
    type: 'select',
    label: 'Label style',
    default: 'normal',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'caps', label: 'Spaced capitals' },
    ],
  },
  {
    id: 'frame_style',
    type: 'select',
    label: 'Frame style',
    default: 'none',
    options: [
      { value: 'none', label: 'None' },
      { value: 'accent', label: 'Thin accent border' },
    ],
  },
  {
    id: 'texture',
    type: 'select',
    label: 'Background texture',
    default: 'none',
    options: [
      { value: 'none', label: 'None' },
      { value: 'dots', label: 'Dots' },
      { value: 'linen', label: 'Linen' },
      { value: 'grid', label: 'Grid' },
    ],
  },
  { id: 'phone_kit', type: 'checkbox', label: 'Phone-friendly layout', default: true },
  { id: 'logo_url', type: 'image', label: 'Logo', default: '' },
  { id: 'favicon_url', type: 'image', label: 'Favicon', default: '' },
  { id: 'custom_css', type: 'textarea', label: 'Custom CSS', default: '', info: 'Applies to the whole store' },
  { id: 'social.instagram', type: 'text', label: 'Instagram', default: '', info: 'Full link, e.g. https://instagram.com/yourstore' },
  { id: 'social.whatsapp', type: 'text', label: 'WhatsApp', default: '', info: 'Full link, e.g. https://wa.me/919800000000' },
  { id: 'social.facebook', type: 'text', label: 'Facebook', default: '', info: 'Full link, e.g. https://facebook.com/yourstore' },
  { id: 'social.youtube', type: 'text', label: 'YouTube', default: '', info: 'Full link, e.g. https://youtube.com/@yourstore' },
  ...PRODUCT_CARD_SETTINGS,
];

// Settings the editor hides because the renderer does not use them yet (M2 D13). Empty since M3 wired
// full_width, the theme's card_style and the footer's show_payment_icons; kept so a future setting can be
// staged the same way.
export const EDITOR_HIDDEN_SETTINGS: {
  theme: readonly string[];
  common: readonly string[];
  sections: Readonly<Record<string, readonly string[]>>;
} = { theme: [], common: [], sections: {} };

const NO_LOCKS: Readonly<Record<string, string>> = Object.freeze({});
const QUICK_LOCKS: Readonly<Record<string, string>> = Object.freeze({ phone_kit: 'Always on in the Quick theme' });

/** D29: theme settings the preset fixes, each with the line the editor shows under the disabled field. */
export function lockedThemeSettings(preset: ThemePreset | undefined): Readonly<Record<string, string>> {
  return preset === 'quick' ? QUICK_LOCKS : NO_LOCKS;
}
