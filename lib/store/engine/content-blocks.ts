import type { BlockSchema } from './schema-types';

// Client-safe on purpose (the editor imports the section schemas): types and schema objects only.

/** The blocks Image with text and Rich text are built from. Order here is the order the editor offers them. */
export const CONTENT_BLOCKS: BlockSchema[] = [
  {
    type: 'eyebrow',
    name: 'Eyebrow',
    settings: [{ id: 'text', type: 'text', label: 'Text', default: '', max_length: 60 }],
  },
  {
    type: 'heading',
    name: 'Heading',
    settings: [
      { id: 'text', type: 'text', label: 'Heading', default: '', max_length: 120 },
      {
        id: 'size',
        type: 'select',
        label: 'Size',
        default: 'medium',
        options: [
          { value: 'small', label: 'Small' },
          { value: 'medium', label: 'Medium' },
          { value: 'large', label: 'Large' },
        ],
      },
    ],
  },
  {
    type: 'text',
    name: 'Text',
    settings: [{ id: 'content', type: 'richtext', label: 'Text', default: '' }],
  },
  {
    type: 'quote',
    name: 'Quote',
    settings: [
      { id: 'text', type: 'textarea', label: 'Quote', default: '', max_length: 400 },
      { id: 'attribution', type: 'text', label: 'Attribution', default: '', max_length: 80 },
    ],
  },
  {
    type: 'checklist_item',
    name: 'Checklist item',
    settings: [
      { id: 'title', type: 'text', label: 'Title', default: '', max_length: 60 },
      { id: 'text', type: 'text', label: 'Text', default: '', max_length: 160 },
    ],
  },
  {
    type: 'button',
    name: 'Button',
    settings: [
      { id: 'label', type: 'text', label: 'Label', default: '', max_length: 30 },
      { id: 'link', type: 'url', label: 'Link', default: '' },
      {
        id: 'style',
        type: 'select',
        label: 'Style',
        default: 'filled',
        options: [
          { value: 'filled', label: 'Filled' },
          { value: 'outline', label: 'Outline' },
        ],
      },
    ],
  },
];

/** A small card that overlaps the image's corner. Image with text only; one per section. */
export const HIGHLIGHT_CARD_BLOCK: BlockSchema = {
  type: 'highlight_card',
  name: 'Highlight card',
  limit: 1,
  settings: [
    { id: 'eyebrow', type: 'text', label: 'Eyebrow', default: '', max_length: 40 },
    { id: 'title', type: 'text', label: 'Title', default: '', max_length: 80 },
    { id: 'text', type: 'textarea', label: 'Text', default: '', max_length: 200 },
  ],
};
