import type { SectionSchema } from '../schema-types';

/** Today's opening hours with the live open/closed badge, the address and Call, WhatsApp and Directions buttons. */
export const storeInfo: SectionSchema = {
  type: 'store-info',
  name: 'Store info',
  category: 'Info',
  templates: ['home', 'page'],
  settings: [
    { id: 'heading', type: 'text', label: 'Heading', default: '', max_length: 60, info: 'Leave empty to use the store name' },
    { id: 'show_hours', type: 'checkbox', label: 'Show opening hours', default: true },
    { id: 'show_address', type: 'checkbox', label: 'Show address', default: true },
    { id: 'show_buttons', type: 'checkbox', label: 'Show Call, WhatsApp and Directions buttons', default: true },
  ],
  presets: [{ name: 'Store info' }],
  data: (settings) => (settings.show_address === false ? {} : { storeAddress: true }),
};
