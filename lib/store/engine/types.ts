export type TemplateKind = 'home' | 'product' | 'catalog' | 'page' | 'header' | 'footer';
export type ThemePreset = 'studio' | 'quick' | 'grocery' | 'khatario' | 'blank';
export type ThemeRole = 'live' | 'draft';

export interface Block {
  type: string;
  settings: Record<string, unknown>;
  disabled?: boolean;
}

export interface Section {
  type: string;
  settings: Record<string, unknown>;
  blocks: Record<string, Block>;
  block_order: string[];
  disabled?: boolean;
  label?: string;
  color_scheme?: string;
  css_class?: string;
  custom_css?: string;
}

export interface Template {
  order: string[];
  sections: Record<string, Section>;
}

export interface PageTemplate extends Template {
  title?: string;
  seo_title?: string;
  seo_description?: string;
}

export interface ColorScheme {
  id: string;
  name: string;
  background: string;
  text: string;
  accent: string;
  button: string;
  button_text: string;
  border: string;
  card: string;
}

export interface ThemeSettings {
  color_schemes: ColorScheme[];
  font_heading: string;
  font_body: string;
  button_radius: number;
  card_style: 'plain' | 'bordered' | 'shadow';
  phone_kit: boolean;
  logo_url: string;
  favicon_url: string;
  custom_css: string;
  social: { instagram: string; whatsapp: string; facebook: string; youtube: string };
}

export interface ThemeData {
  settings: ThemeSettings;
  header_group: Template;
  footer_group: Template;
  templates: Record<string, PageTemplate>;
}

export interface ThemeRow {
  id: string;
  business_id: string;
  name: string;
  role: ThemeRole;
  preset: ThemePreset;
  data: ThemeData;
  updated_at: string;
  is_working: boolean;
}
