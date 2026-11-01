import type { SectionSchema } from '../schema-types';

export const spacer: SectionSchema = {
  type: 'spacer',
  name: 'Spacer',
  category: 'Advanced',
  templates: ['home', 'page', 'product', 'catalog'],
  settings: [
    { id: 'height', type: 'range', label: 'Height', min: 0, max: 160, step: 8, default: 48 },
    { id: 'height_mobile', type: 'range', label: 'Height on phones', min: 0, max: 160, step: 8, default: 32 },
  ],
  presets: [{ name: 'Spacer', settings: { height: 48, height_mobile: 32 } }],
};
