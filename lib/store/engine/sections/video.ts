import type { SectionSchema } from '../schema-types';

export const video: SectionSchema = {
  type: 'video',
  name: 'Video',
  category: 'Media',
  templates: ['home', 'page', 'product', 'catalog'],
  settings: [
    { id: 'video_url', type: 'video_url', label: 'Video link', info: 'A YouTube or Vimeo link', default: '' },
    { id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 80 },
    { id: 'cover_image', type: 'image', label: 'Cover image', info: 'Shown until the video is played', default: '' },
  ],
  presets: [{ name: 'Video', settings: { heading: 'See it in action' } }],
};
