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
  categories?: boolean;
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
