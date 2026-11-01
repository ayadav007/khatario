import type { SectionSchema } from '../schema-types';

export const countdown: SectionSchema = {
  type: 'countdown',
  name: 'Countdown',
  category: 'Banners',
  templates: ['home', 'page'],
  settings: [
    { id: 'heading', type: 'text', label: 'Heading', default: 'Sale ends in', max_length: 80 },
    { id: 'ends_at', type: 'text', label: 'Ends at', info: 'Date and time, like 2026-12-31T23:59', default: '', max_length: 40 },
    { id: 'link', type: 'url', label: 'Button link', default: '' },
    { id: 'button_label', type: 'text', label: 'Button label', default: '', max_length: 30 },
    { id: 'hide_when_over', type: 'checkbox', label: 'Hide when over', default: true },
  ],
  presets: [{ name: 'Countdown', settings: { heading: 'Sale ends in', button_label: 'Shop now', link: '/catalog' } }],
};
