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

// Settings the editor hides because the renderer does not use them yet (M2 D13). Empty since M3 wired
// full_width, the theme's card_style and the footer's show_payment_icons; kept so a future setting can be
// staged the same way.
export const EDITOR_HIDDEN_SETTINGS: {
  theme: readonly string[];
  common: readonly string[];
  sections: Readonly<Record<string, readonly string[]>>;
} = { theme: [], common: [], sections: {} };
