import type { TemplateKind } from './types';

export type SettingType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'range'
  | 'checkbox'
  | 'select'
  | 'radio'
  | 'color'
  | 'color_scheme'
  | 'image'
  | 'video_url'
  | 'url'
  | 'product'
  | 'product_list'
  | 'category'
  | 'category_list'
  | 'icon'
  | 'font'
  | 'html'
  | 'menu'
  | 'header';

export interface SettingSchema {
  id: string;
  type: SettingType;
  label: string;
  default?: unknown;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  max_length?: number;
  info?: string;
  /** `image` settings: also take an MP4 or WebM upload, which the section plays as a muted loop. */
  video?: boolean;
}

export interface BlockSchema {
  type: string;
  name: string;
  limit?: number;
  settings: SettingSchema[];
}

export interface SectionDataRequest {
  products?: {
    source: 'all' | 'featured' | 'new' | 'bestsellers' | 'discounted' | 'category' | 'price_max';
    categoryId?: string;
    priceMax?: number;
    limit: number;
  };
  /** Products by id, at most 12; each section gets the ones found, keyed by id. */
  productIds?: string[];
  categories?: boolean;
  /** A failed categories lookup gives this section no categories instead of an error (the section still renders). */
  categoriesOptional?: boolean;
  /** Category shelves: the first `maxCategories` categories with products, `perShelf` products each. */
  shelves?: { maxCategories: number; perShelf: number };
}

export interface SectionSchema {
  type: string;
  name: string;
  category:
    | 'Header and footer'
    | 'Banners'
    | 'Products'
    | 'Text'
    | 'Media'
    | 'Social proof'
    | 'Product page'
    | 'Catalog'
    | 'Advanced';
  templates: TemplateKind[];
  limit?: number;
  settings: SettingSchema[];
  blocks?: BlockSchema[];
  max_blocks?: number;
  presets: Array<{
    name: string;
    settings?: Record<string, unknown>;
    blocks?: Array<{ type: string; settings?: Record<string, unknown> }>;
  }>;
  data?: (settings: Record<string, unknown>) => SectionDataRequest;
}
