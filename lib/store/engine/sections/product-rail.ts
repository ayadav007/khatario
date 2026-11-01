import type { SectionSchema } from '../schema-types';
import { productData, productSettings } from './featured-products';

export const productRail: SectionSchema = {
  type: 'product-rail',
  name: 'Product rail',
  category: 'Products',
  templates: ['home', 'page', 'product', 'catalog'],
  settings: productSettings(false),
  presets: [{ name: 'Product rail', settings: { heading: 'New arrivals', source: 'new', limit: 8 } }],
  data: productData,
};
