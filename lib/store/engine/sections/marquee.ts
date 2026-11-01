import type { SectionSchema } from '../schema-types';

export const marquee: SectionSchema = {
  type: 'marquee',
  name: 'Marquee',
  category: 'Text',
  templates: ['home', 'page'],
  settings: [{ id: 'speed', type: 'range', label: 'Speed', min: 10, max: 60, step: 1, default: 30 }],
  blocks: [
    {
      type: 'item',
      name: 'Item',
      limit: 12,
      settings: [{ id: 'text', type: 'text', label: 'Text', default: '', max_length: 60 }],
    },
  ],
  max_blocks: 12,
  presets: [
    {
      name: 'Marquee',
      settings: { speed: 30 },
      blocks: [{ type: 'item', settings: { text: 'Free delivery' } }, { type: 'item', settings: { text: 'New arrivals weekly' } }],
    },
  ],
};
