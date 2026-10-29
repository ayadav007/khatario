import type { SectionSchema } from '../schema-types';

export const announcement: SectionSchema = {
  type: 'announcement',
  name: 'Announcement bar',
  category: 'Header and footer',
  templates: ['header'],
  limit: 1,
  settings: [
    { id: 'text', type: 'text', label: 'Text', default: 'Free delivery on orders above ₹499', max_length: 200 },
    { id: 'link', type: 'url', label: 'Link', default: '' },
    {
      id: 'text_align',
      type: 'select',
      label: 'Text alignment',
      default: 'center',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ],
    },
  ],
  presets: [{ name: 'Announcement bar', settings: { text: 'Free delivery on orders above ₹499', text_align: 'center' } }],
};
