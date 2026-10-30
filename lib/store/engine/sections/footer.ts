import type { SectionSchema } from '../schema-types';

export const footer: SectionSchema = {
  type: 'footer',
  name: 'Footer',
  category: 'Header and footer',
  templates: ['footer'],
  limit: 1,
  settings: [
    { id: 'about', type: 'textarea', label: 'About text', default: '', max_length: 500 },
    { id: 'show_social', type: 'checkbox', label: 'Show social links', default: true },
    { id: 'show_payment_icons', type: 'checkbox', label: 'Show payment icons', default: false },
    { id: 'badge', type: 'checkbox', label: 'Show Khatario badge', default: true },
  ],
  blocks: [
    {
      type: 'link_column',
      name: 'Link column',
      limit: 4,
      settings: [
        { id: 'heading', type: 'text', label: 'Heading', default: 'Shop', max_length: 60 },
        { id: 'links', type: 'textarea', label: 'Links', info: 'One per line as Label|/url', default: '', max_length: 1000 },
      ],
    },
  ],
  max_blocks: 4,
  presets: [
    {
      name: 'Footer',
      settings: { show_social: true, show_payment_icons: false },
      blocks: [{ type: 'link_column', settings: { heading: 'Shop', links: 'All Products|/' } }],
    },
  ],
};
