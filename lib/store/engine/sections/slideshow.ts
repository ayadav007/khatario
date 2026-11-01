import type { SectionSchema } from '../schema-types';
import { ALIGN_OPTIONS, POSITION_OPTIONS } from './image-banner';

const HEADING_SIZES = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'xl', label: 'Extra large' },
  { value: 'xxl', label: 'Extra extra large' },
];

const BUTTON_STYLES = [
  { value: 'filled', label: 'Filled' },
  { value: 'outline', label: 'Outline' },
];

export const slideshow: SectionSchema = {
  type: 'slideshow',
  name: 'Slideshow',
  category: 'Banners',
  templates: ['home', 'page'],
  settings: [
    { id: 'autoplay', type: 'checkbox', label: 'Autoplay', default: true },
    { id: 'speed', type: 'range', label: 'Seconds per slide', min: 3, max: 10, step: 1, default: 5 },
    {
      id: 'height',
      type: 'select',
      label: 'Height',
      default: 'medium',
      options: [
        { value: 'small', label: 'Small' },
        { value: 'medium', label: 'Medium' },
        { value: 'large', label: 'Large' },
      ],
    },
    {
      id: 'image_fit',
      type: 'select',
      label: 'Image fit',
      default: 'cover',
      options: [
        { value: 'cover', label: 'Fill the space (edges may be cut)' },
        { value: 'contain', label: 'Show the whole image' },
        { value: 'natural', label: "Match the image's shape" },
      ],
      info: "The slideshow changes shape with the screen, so Fill trims some edge: keep text in the middle. Match the image's shape never cuts and ignores Height.",
    },
    {
      id: 'layout',
      type: 'select',
      label: 'Layout',
      default: 'image-text',
      options: [
        { value: 'full', label: 'Full image' },
        { value: 'image-text', label: 'Image then text' },
        { value: 'text-image', label: 'Text then image' },
      ],
    },
    { id: 'text_below_mobile', type: 'checkbox', label: 'Text below the picture on phones', default: false },
  ],
  blocks: [
    {
      type: 'slide',
      name: 'Slide',
      limit: 6,
      settings: [
        { id: 'pictures_header', type: 'header', label: 'Pictures' },
        {
          id: 'image',
          type: 'image',
          label: 'Image or video',
          default: '',
          video: true,
          info: 'Best size: 1920 × 640 px (3:1) for Full image, 1200 × 800 px beside text. A Canva ad works as MP4 (plays silently on loop) or GIF; MP4 is smaller and smoother.',
        },
        {
          id: 'mobile_image',
          type: 'image',
          label: 'Phone image or video (optional)',
          default: '',
          video: true,
          info: 'Shown on phones instead of the one above. Best size: 1080 × 1080 px (square).',
        },
        {
          id: 'device',
          type: 'select',
          label: 'Show on',
          default: 'both',
          options: [
            { value: 'both', label: 'Phones and desktops' },
            { value: 'mobile', label: 'Phones only' },
            { value: 'desktop', label: 'Desktops only' },
          ],
        },
        { id: 'words_header', type: 'header', label: 'Words' },
        { id: 'eyebrow', type: 'text', label: 'Label', default: '', max_length: 60 },
        { id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 120 },
        { id: 'heading_size', type: 'select', label: 'Heading size', default: 'large', options: HEADING_SIZES },
        { id: 'description', type: 'textarea', label: 'Subheading', default: '', max_length: 300 },
        { id: 'buttons_header', type: 'header', label: 'Buttons' },
        { id: 'button_text', type: 'text', label: 'Button text', default: 'Shop now', max_length: 30 },
        { id: 'link', type: 'url', label: 'Link', default: '' },
        { id: 'button_style', type: 'select', label: 'Button style', default: 'filled', options: BUTTON_STYLES },
        { id: 'button_2_text', type: 'text', label: 'Second button text', default: '', max_length: 30 },
        { id: 'button_2_link', type: 'url', label: 'Second button link', default: '' },
        { id: 'button_2_style', type: 'select', label: 'Second button style', default: 'filled', options: BUTTON_STYLES },
        { id: 'layout_header', type: 'header', label: 'Layout' },
        {
          id: 'position',
          type: 'select',
          label: 'Text position',
          default: 'middle-left',
          options: POSITION_OPTIONS,
          info: 'With Image then text or Text then image only the row (top, middle, bottom) applies.',
        },
        { id: 'align', type: 'select', label: 'Text alignment', default: 'left', options: ALIGN_OPTIONS },
        { id: 'align_mobile', type: 'select', label: 'Text alignment on phones', default: 'left', options: ALIGN_OPTIONS },
        { id: 'box', type: 'checkbox', label: 'Box behind the text', default: false, info: 'Puts the words on a card in the slide colours' },
        { id: 'colours_header', type: 'header', label: 'Colours' },
        { id: 'overlay', type: 'range', label: 'Photo darkening (%)', min: 0, max: 80, step: 5, default: 0, info: 'A dark layer over the photo so text on it stays readable' },
        { id: 'text_color', type: 'color', label: 'Text colour', default: '', info: 'Heading, subheading and label. Empty: white on a full photo, else the slide colours.' },
        { id: 'color_scheme', type: 'color_scheme', label: 'Colour scheme', info: "Empty: the slideshow's own colours." },
      ],
    },
  ],
  max_blocks: 6,
  presets: [
    {
      name: 'Slideshow',
      settings: { autoplay: true, speed: 5 },
      blocks: [{ type: 'slide', settings: { heading: 'Welcome', button_text: 'Shop now', link: '/' } }],
    },
  ],
};
