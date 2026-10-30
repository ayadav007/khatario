import type { SectionSchema } from '../schema-types';

export const faq: SectionSchema = {
  type: 'faq',
  name: 'FAQ',
  category: 'Text',
  templates: ['home', 'page', 'product', 'catalog'],
  settings: [{ id: 'heading', type: 'text', label: 'Heading', default: 'Frequently asked questions', max_length: 120 }],
  blocks: [
    {
      type: 'question',
      name: 'Question',
      limit: 30,
      settings: [
        { id: 'question', type: 'text', label: 'Question', default: '', max_length: 160 },
        { id: 'answer', type: 'richtext', label: 'Answer', default: '' },
      ],
    },
  ],
  max_blocks: 30,
  presets: [
    {
      name: 'FAQ',
      settings: { heading: 'Frequently asked questions' },
      blocks: [{ type: 'question', settings: { question: 'How long does delivery take?', answer: '<p>Most orders arrive in 2 to 4 days.</p>' } }],
    },
  ],
};
