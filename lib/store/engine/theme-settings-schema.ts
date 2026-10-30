// Client-safe: types only. Defaults match presets/shared.ts.
import type { SettingSchema } from './schema-types';

export const THEME_SETTINGS_SCHEMA: SettingSchema[] = [
  { id: 'font_heading', type: 'font', label: 'Heading font', default: 'outfit' },
  { id: 'font_body', type: 'font', label: 'Body font', default: 'inter' },
  { id: 'button_radius', type: 'range', label: 'Button corner radius', min: 0, max: 32, step: 1, default: 10 },
  {
    id: 'card_style',
    type: 'select',
    label: 'Card style',
    default: 'bordered',
    options: [
      { value: 'plain', label: 'Plain' },
      { value: 'bordered', label: 'Bordered' },
      { value: 'shadow', label: 'Shadow' },
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
];

// Settings not wired in the renderer until M3, so the editor hides them (D13). Scoped: the theme's
// card_style is hidden but a section's own card_style (featured-products, product-rail) is wired.
export const EDITOR_HIDDEN_SETTINGS = {
  theme: ['card_style'],
  common: ['full_width'],
  sections: { footer: ['show_payment_icons'] },
} as const;
