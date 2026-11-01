import type { SectionSchema } from '../schema-types';

/** A grid, masonry or strip of images, each with an optional caption and link. */
export const imageGallery: SectionSchema = {
  type: 'image-gallery',
  name: 'Image gallery',
  category: 'Media',
  templates: ['home', 'page', 'product'],
  settings: [
    { id: 'eyebrow', type: 'text', label: 'Eyebrow', default: '', max_length: 60 },
    { id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 120 },
    {
      id: 'layout',
      type: 'select',
      label: 'Layout',
      default: 'grid',
      options: [
        { value: 'grid', label: 'Grid' },
        { value: 'masonry', label: 'Masonry' },
        { value: 'strip', label: 'Scrolling strip' },
      ],
    },
    { id: 'columns', type: 'range', label: 'Columns', min: 2, max: 6, step: 1, default: 4 },
    {
      id: 'shape',
      type: 'select',
      label: 'Image shape',
      default: 'square',
      options: [
        { value: 'square', label: 'Square' },
        { value: 'portrait', label: 'Portrait' },
        { value: 'natural', label: 'Natural' },
      ],
    },
    {
      id: 'hover',
      type: 'select',
      label: 'On hover',
      default: 'caption',
      options: [
        { value: 'none', label: 'Nothing' },
        { value: 'caption', label: 'Show caption' },
        { value: 'caption-link', label: 'Show caption and link' },
      ],
    },
    { id: 'gap', type: 'range', label: 'Gap', min: 0, max: 32, step: 4, default: 8 },
  ],
  blocks: [
    {
      type: 'image',
      name: 'Image',
      settings: [
        { id: 'image', type: 'image', label: 'Image', default: '' },
        { id: 'caption', type: 'text', label: 'Caption', default: '', max_length: 80 },
        { id: 'subcaption', type: 'text', label: 'Subcaption', default: '', max_length: 60 },
        { id: 'link', type: 'url', label: 'Link', default: '' },
      ],
    },
  ],
  max_blocks: 16,
  presets: [
    {
      name: 'Image gallery',
      settings: { layout: 'grid', columns: 4 },
      blocks: [{ type: 'image' }, { type: 'image' }, { type: 'image' }, { type: 'image' }],
    },
  ],
};
