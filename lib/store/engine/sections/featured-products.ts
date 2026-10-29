import type { SectionDataRequest, SectionSchema, SettingSchema } from '../schema-types';

type ProductsRequest = NonNullable<SectionDataRequest['products']>;

export const PRODUCT_SOURCE_OPTIONS = [
  { value: 'all', label: 'All products' },
  { value: 'featured', label: 'Featured' },
  { value: 'new', label: 'New arrivals' },
  { value: 'bestsellers', label: 'Bestsellers' },
  { value: 'discounted', label: 'Discounted' },
  { value: 'category', label: 'Category' },
  { value: 'price_max', label: 'Under a price' },
];

/** Product-source settings shared by featured-products and product-rail. */
export function productSettings(withColumns: boolean): SettingSchema[] {
  return [
    { id: 'heading', type: 'text', label: 'Heading', default: 'Handpicked for you', max_length: 120 },
    { id: 'eyebrow', type: 'text', label: 'Eyebrow', default: '', max_length: 60 },
    { id: 'source', type: 'select', label: 'Products', default: 'all', options: PRODUCT_SOURCE_OPTIONS },
    { id: 'category', type: 'category', label: 'Category' },
    { id: 'price_max', type: 'number', label: 'Maximum price', min: 1, max: 999999 },
    { id: 'limit', type: 'range', label: 'Number of products', min: 2, max: 24, step: 1, default: 8 },
    ...(withColumns
      ? [{ id: 'columns', type: 'range', label: 'Columns', min: 2, max: 6, step: 1, default: 4 } as SettingSchema]
      : []),
    {
      id: 'card_style',
      type: 'select',
      label: 'Card style',
      default: 'bordered',
      options: [
        { value: 'bordered', label: 'Bordered' },
        { value: 'shadow', label: 'Shadow' },
        { value: 'minimal', label: 'Minimal' },
      ],
    },
    { id: 'show_rating', type: 'checkbox', label: 'Show rating', default: true },
    { id: 'show_badges', type: 'checkbox', label: 'Show badges', default: true },
  ];
}

/** Builds the product data request, leaving out unset keys. */
export function productData(s: Record<string, unknown>): SectionDataRequest {
  const products: ProductsRequest = {
    source: (typeof s.source === 'string' ? s.source : 'all') as ProductsRequest['source'],
    limit: typeof s.limit === 'number' ? s.limit : 8,
  };
  if (typeof s.category === 'string' && s.category) products.categoryId = s.category;
  if (typeof s.price_max === 'number') products.priceMax = s.price_max;
  return { products };
}

export const featuredProducts: SectionSchema = {
  type: 'featured-products',
  name: 'Featured products',
  category: 'Products',
  templates: ['home', 'page', 'product', 'catalog'],
  settings: productSettings(true),
  presets: [{ name: 'Featured products', settings: { heading: 'Handpicked for you', source: 'featured', limit: 8, columns: 4 } }],
  data: productData,
};
