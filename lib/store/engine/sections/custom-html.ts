import type { SectionSchema } from '../schema-types';

export const customHtml: SectionSchema = {
  type: 'custom-html',
  name: 'Custom HTML',
  category: 'Advanced',
  templates: ['home', 'product', 'catalog', 'page'],
  settings: [{ id: 'html', type: 'html', label: 'HTML', default: '', info: 'Up to 20 KB. Scripts are removed.' }],
  presets: [{ name: 'Custom HTML', settings: { html: '<p>Your content here</p>' } }],
};
