import type { SectionSchema } from '../schema-types';

export const footer: SectionSchema = {
  type: 'footer',
  name: 'Footer',
  category: 'Header and footer',
  templates: ['footer'],
  limit: 1,
  settings: [
    { id: 'menu', type: 'menu', label: 'Menu', default: 'footer' },
    { id: 'about', type: 'textarea', label: 'About text', default: '', max_length: 500 },
    { id: 'show_social', type: 'checkbox', label: 'Show social links', default: true },
    { id: 'show_payment_icons', type: 'checkbox', label: 'Show payment icons', default: false },
    { id: 'badge', type: 'checkbox', label: 'Show Khatario badge', default: true },
  ],
  presets: [
    {
      name: 'Footer',
      settings: { show_social: true, show_payment_icons: false },
    },
  ],
  // Automatic categories in a footer menu use the same optional lookup as the header: a failed lookup drops only them.
  data: () => ({ categories: true, categoriesOptional: true }),
};
