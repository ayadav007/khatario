// Server-only (imports the engine sanitiser). D31: a pure conversion of `business_settings.store_theme` into the
// store's first engine theme. No db, no clock, no randomness.
import {
  STORE_THEME_PRESETS,
  chowkOnAccent,
  sanitizeStoreTheme,
  storeCanvas,
  type StoreTheme,
} from '@/lib/store/store-theme';
import { resolveStudioSections, themeToStudioSections } from '@/lib/store/studio-layout';
import type { ColorScheme, ThemeData, ThemeSettings } from './types';
import { PRESET_LOOK, mixHex, schemesFor } from './presets/look';
import { engineUrl, keepImage, migrateStudioSections, studioContextFor, Warnings } from './migrate-studio';
import { migratePackHome } from './migrate-packs';

export interface MigrationContext {
  businessName: string;
  tagline: string;
  aboutMd: string;
  heroUrl: string;
  logoUrl: string;
  categories: Array<{ id: string; name: string }>;
}

export interface MigrationResult {
  preset: 'studio' | 'quick' | 'grocery' | 'khatario';
  name: string;
  data: ThemeData;
  warnings: string[];
}

const THEME_CSS_MAX = 8000;
const STUDIO_SECTION_CAP = 24;

/** Scheme 5 rebuilt from custom announcement colours (D31). */
function announcementScheme(base: ColorScheme, accent: string, bg: string, fg: string): ColorScheme {
  const background = bg || accent;
  const text = fg || chowkOnAccent(background);
  return {
    ...base,
    name: 'Announcement',
    background,
    text,
    accent: text,
    button: text,
    button_text: background,
    border: mixHex(text, background, 0.2),
    card: mixHex(text, background, 0.08),
  };
}

function migrateSettings(t: StoreTheme, ctx: MigrationContext, w: Warnings): ThemeSettings {
  const look = PRESET_LOOK[t.pack];
  const font = t.font_family === 'system' ? null : t.font_family;
  const css = t.custom_css.slice(0, THEME_CSS_MAX).replace(/</g, '');
  if (css.trim()) w.add('The store CSS was copied, but it was written for the old layout; check it in Studio 2.');
  const social = (value: string, kind: string): string => {
    if (!value) return '';
    const out = engineUrl(value);
    if (!out) w.add(`The ${kind} link was left out: the new theme only takes https links.`);
    return out;
  };
  if (t.mobile_columns !== 2 && t.pack !== 'quick') w.add('Three product columns on phones is not carried over.');
  return {
    color_schemes: schemesFor(t.pack, t.accent, storeCanvas(t)),
    font_heading: font ?? look.font_heading,
    font_body: font ?? look.font_body,
    button_radius: look.button_radius,
    card_style: look.card_style,
    phone_kit: t.pack === 'quick' ? true : t.phone_kit,
    logo_url: keepImage(t.logo_url || ctx.logoUrl, 'logo', w),
    favicon_url: keepImage(t.favicon_url, 'favicon', w),
    custom_css: css,
    social: {
      instagram: social(t.instagram_url, 'Instagram'),
      whatsapp: social(t.whatsapp_url, 'WhatsApp'),
      facebook: '',
      youtube: '',
    },
  };
}

export function migrateStoreTheme(raw: unknown, ctx: MigrationContext): MigrationResult {
  const t = sanitizeStoreTheme(raw);
  const w = new Warnings();
  const settings = migrateSettings(t, ctx, w);
  const studioCtx = studioContextFor(ctx);

  const rawSections = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).studio_sections : undefined;
  if (Array.isArray(rawSections) && rawSections.length > STUDIO_SECTION_CAP && rawSections.length > t.studio_sections.length) {
    const hidden = rawSections.length - t.studio_sections.length;
    w.add(`${hidden} saved Studio sections were already hidden on the old store (it shows at most ${STUDIO_SECTION_CAP}) and are not carried over.`);
  }

  const studioLike = t.pack === 'studio' || t.pack === 'quick';
  // Grocery and Khatario take only the announcement, header and footer from the Studio view; their home is mapped apart.
  const sections = studioLike
    ? resolveStudioSections(t, studioCtx)
    : themeToStudioSections(t, studioCtx).filter((s) => s.type === 'announcement' || s.type === 'header' || s.type === 'footer');
  const groups = migrateStudioSections(sections, t, ctx);
  for (const m of groups.warnings) w.add(m);

  let home = groups.home;
  if (!studioLike) {
    const pack = migratePackHome(t, ctx);
    home = pack.home;
    for (const m of pack.warnings) w.add(m);
  }

  // D31: custom announcement colours replace scheme 5, renamed "Announcement", and the bar uses it.
  const announcement = groups.header.sections.announcement;
  const annSrc = sections.find((s) => s.type === 'announcement');
  const bg = annSrc ? annSrc.settings.background ?? '' : t.announcement_bg;
  const fg = annSrc ? annSrc.settings.textColor ?? '' : t.announcement_fg;
  if (announcement && (bg || fg)) {
    settings.color_schemes[4] = announcementScheme(settings.color_schemes[4], t.accent, bg, fg);
    announcement.color_scheme = settings.color_schemes[4].id;
  }

  const data: ThemeData = {
    settings,
    header_group: groups.header,
    footer_group: groups.footer,
    templates: {
      home,
      product: { order: [], sections: {} },
      catalog: { order: [], sections: {} },
    },
  };
  return { preset: t.pack, name: STORE_THEME_PRESETS[t.pack].label, data, warnings: w.all() };
}
