import type { SectionSchema } from '../schema-types';

export const newsletter: SectionSchema = {
  type: 'newsletter',
  name: 'Newsletter signup',
  category: 'Text',
  templates: ['home', 'page'],
  settings: [
    { id: 'heading', type: 'text', label: 'Heading', default: 'Get offers first', max_length: 80 },
    { id: 'text', type: 'textarea', label: 'Text', default: '', max_length: 200 },
    { id: 'button_label', type: 'text', label: 'Button label', default: 'Subscribe', max_length: 30 },
    { id: 'success_text', type: 'text', label: 'Thank-you message', default: "Thanks, you're on the list.", max_length: 120 },
  ],
  presets: [{ name: 'Newsletter signup', settings: { heading: 'Get offers first', text: 'New arrivals and deals, straight to your inbox.' } }],
};
