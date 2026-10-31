import type { SectionSchema } from '../schema-types';

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
    { id: 'text_color', type: 'color', label: 'Text colour', default: '', info: 'Heading, description and eyebrow. Empty: white on a full photo, else the section colours.' },
    { id: 'overlay', type: 'range', label: 'Darken photo (%)', min: 0, max: 80, step: 5, default: 0, info: 'A dark layer over the photo so text on it stays readable' },
  ],
  blocks: [
    {
      type: 'slide',
      name: 'Slide',
      limit: 6,
      settings: [
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
        { id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 120 },
        { id: 'description', type: 'textarea', label: 'Description', default: '', max_length: 300 },
        { id: 'button_text', type: 'text', label: 'Button text', default: 'Shop now', max_length: 30 },
        { id: 'link', type: 'url', label: 'Link', default: '' },
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
