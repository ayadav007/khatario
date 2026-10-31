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
  /** This section's own colours (hex), over its scheme (or scheme 1); set from the editor's Custom tile. */
  custom_colors?: Partial<SchemeColors>;
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

/** A colour scheme's seven colours, without its id and name. */
export type SchemeColors = Omit<ColorScheme, 'id' | 'name'>;

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

/** A library row (D40): no data; `has_changes` is true only for the working draft when it differs from the live theme. */
export type ThemeListRow = Omit<ThemeRow, 'data'> & { has_changes: boolean };

/** One published version in the business's timeline (D46). No user ids and no data. */
export interface ThemeVersionSummary {
  id: string;
  theme_id: string | null;
  theme_name: string;
  preset: ThemePreset;
  published_at: string;
  published_by_name: string | null;
  theme_exists: boolean;
}

export interface ThemeVersionRow extends ThemeVersionSummary {
  business_id: string;
  data: ThemeData;
}
