import type { BlockSchema, SectionSchema, SettingSchema } from '../schema-types';
import { CONTENT_BLOCKS, COUNTDOWN_BLOCK } from '../content-blocks';

const HERO_BLOCK_TYPES = ['eyebrow', 'heading', 'text', 'button'];

/**
 * The hero's words. Cloned from the shared content blocks (never changed in place, so Image with text and Rich text keep
 * their own caps): at most two buttons here, and the eyebrow reads "Label".
 */
const HERO_BLOCKS: BlockSchema[] = CONTENT_BLOCKS.filter((b) => HERO_BLOCK_TYPES.includes(b.type)).map((b) => {
  if (b.type === 'button') return { ...b, limit: 2 };
  if (b.type === 'eyebrow') return { ...b, name: 'Label' };
  return b;
}).concat(COUNTDOWN_BLOCK);

/** The nine places the words can sit; the slideshow's slides use the same list. */
export const POSITION_OPTIONS: SettingSchema['options'] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-center', label: 'Top centre' },
  { value: 'top-right', label: 'Top right' },
  { value: 'middle-left', label: 'Middle left' },
  { value: 'middle-center', label: 'Middle centre' },
  { value: 'middle-right', label: 'Middle right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-center', label: 'Bottom centre' },
  { value: 'bottom-right', label: 'Bottom right' },
];

export const ALIGN_OPTIONS: SettingSchema['options'] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' },
];

export const imageBanner: SectionSchema = {
  type: 'image-banner',
  name: 'Hero banner',
  category: 'Banners',
  templates: ['home', 'page', 'catalog'],
  settings: [
    { id: 'pictures_header', type: 'header', label: 'Pictures' },
    {
      id: 'image',
      type: 'image',
      label: 'Picture or video',
      default: '',
      video: true,
      info: 'A picture, or an MP4 or GIF that plays silently on a loop',
    },
    {
      id: 'image_2',
      type: 'image',
      label: 'Second picture or video',
      default: '',
      video: true,
      info: 'Shown next to the first one, sharing the width',
    },
    {
      id: 'mobile_image',
      type: 'image',
      label: 'Phone picture or video',
      default: '',
      video: true,
      info: 'Shown on phones instead of the pictures above. Best size: 1080 × 1080 px (square).',
    },
    {
      id: 'height',
      type: 'select',
      label: 'Height',
      default: 'medium',
      options: [
        { value: 'adapt', label: 'Fit the picture' },
        { value: 'small', label: 'Small' },
        { value: 'medium', label: 'Medium' },
        { value: 'large', label: 'Large' },
      ],
    },
    {
      id: 'height_px',
      type: 'range',
      label: 'Height on computers (px)',
      min: 0,
      max: 1000,
      step: 20,
      default: 0,
      info: '0 uses the Height choice above. Words that need more room still fit.',
    },
    {
      id: 'height_px_mobile',
      type: 'range',
      label: 'Height on phones (px)',
      min: 0,
      max: 800,
      step: 20,
      default: 0,
      info: '0 uses the Height choice above.',
    },
    {
      id: 'overlay',
      type: 'range',
      label: 'Photo darkening (%)',
      min: 0,
      max: 80,
      step: 5,
      default: 40,
      info: 'A dark layer over the picture so the words on it stay readable',
    },
    {
      id: 'motion',
      type: 'select',
      label: 'Movement',
      default: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'drift', label: 'Slow drift' },
        { value: 'zoom_scroll', label: 'Zoom in while scrolling' },
        { value: 'fixed', label: 'Picture stays still while page scrolls' },
      ],
    },
    { id: 'words_header', type: 'header', label: 'Words' },
    {
      id: 'layout',
      type: 'select',
      label: 'Words over or beside the photo',
      default: 'over',
      options: [
        { value: 'over', label: 'Over the photo' },
        { value: 'image-text', label: 'Photo left, words right' },
        { value: 'text-image', label: 'Words left, photo right' },
      ],
      info: 'Beside the photo, Text position places the words in their half, the photo is not darkened, and phones show the photo above the words.',
    },
    { id: 'position', type: 'select', label: 'Text position', default: 'middle-left', options: POSITION_OPTIONS },
    { id: 'align', type: 'select', label: 'Text alignment', default: 'left', options: ALIGN_OPTIONS },
    { id: 'box', type: 'checkbox', label: 'Box behind the text', default: false, info: 'Puts the words on a card in the section colours' },
    { id: 'text_color', type: 'color', label: 'Text colour', default: '', info: 'Empty: white over a picture, else the section colours.' },
    { id: 'phones_header', type: 'header', label: 'Phones' },
    { id: 'align_mobile', type: 'select', label: 'Text alignment on phones', default: 'left', options: ALIGN_OPTIONS },
    { id: 'text_below_mobile', type: 'checkbox', label: 'Text below the picture on phones', default: false },
    {
      id: 'two_images_mobile',
      type: 'select',
      label: 'Two pictures on phones',
      default: 'stack',
      options: [
        { value: 'stack', label: 'Stack' },
        { value: 'first', label: 'First only' },
      ],
    },
  ],
  blocks: HERO_BLOCKS,
  max_blocks: 8,
  presets: [
    {
      name: 'Hero banner',
      blocks: [
        { type: 'heading', settings: { text: 'New arrivals' } },
        { type: 'text', settings: { content: '<p>Fresh picks for the season</p>' } },
        { type: 'button', settings: { label: 'Shop now', link: '/catalog' } },
      ],
    },
  ],
};
