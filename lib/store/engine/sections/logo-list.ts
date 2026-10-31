import type { SectionSchema } from '../schema-types';

export const logoList: SectionSchema = {
  type: 'logo-list',
  name: 'Logo list',
  category: 'Social proof',
  templates: ['home', 'page'],
  settings: [{ id: 'heading', type: 'text', label: 'Heading', default: 'As seen in', max_length: 80 }],
  blocks: [
    {
      type: 'logo',
      name: 'Logo',
      limit: 16,
      settings: [
        { id: 'image', type: 'image', label: 'Logo', default: '' },
        { id: 'link', type: 'url', label: 'Link', default: '' },
        { id: 'alt', type: 'text', label: 'Alt text', default: '', max_length: 60 },
        { id: 'name', type: 'text', label: 'Name (shown when there is no logo image)', default: '', max_length: 40 },
        { id: 'caption', type: 'text', label: 'Caption', default: '', max_length: 80 },
      ],
    },
  ],
  max_blocks: 16,
  presets: [{ name: 'Logo list', settings: { heading: 'As seen in' }, blocks: [{ type: 'logo' }, { type: 'logo' }, { type: 'logo' }] }],
};
