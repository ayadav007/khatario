import type { SectionSchema } from '../schema-types';

export const testimonials: SectionSchema = {
  type: 'testimonials',
  name: 'Testimonials',
  category: 'Social proof',
  templates: ['home', 'page', 'product'],
  settings: [{ id: 'heading', type: 'text', label: 'Heading', default: 'What customers say', max_length: 120 }],
  blocks: [
    {
      type: 'quote',
      name: 'Quote',
      limit: 12,
      settings: [
        { id: 'text', type: 'textarea', label: 'Quote', default: '', max_length: 400 },
        { id: 'name', type: 'text', label: 'Name', default: '', max_length: 60 },
        { id: 'photo', type: 'image', label: 'Photo', default: '' },
        { id: 'rating', type: 'range', label: 'Rating', min: 1, max: 5, step: 1, default: 5 },
      ],
    },
  ],
  max_blocks: 12,
  presets: [
    {
      name: 'Testimonials',
      blocks: [{ type: 'quote', settings: { text: 'Great quality and quick delivery.', name: 'A happy customer', rating: 5 } }],
    },
  ],
};
