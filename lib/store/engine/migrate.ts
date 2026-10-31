// Server-only (imports the engine sanitiser). D31: a pure conversion of `business_settings.store_theme` into the
// store's first engine theme. No db, no clock, no randomness.
import {
  STORE_THEME_PRESETS,
  chowkOnAccent,
  resolveAnnouncementText,
  sanitizeStoreTheme,
  sectionEnabled,
  storeCanvas,
  type StoreTheme,
} from '@/lib/store/store-theme';
import { resolveStudioSections, themeToStudioSections } from '@/lib/store/studio-layout';
import type { ColorScheme, Section, Template, ThemeData, ThemeSettings } from './types';
import { PRESET_LOOK, mixHex, schemesFor } from './presets/look';
import { template } from './presets/shared';
import { engineSection, engineUrl, keepImage, migrateStudioSections, studioContextFor, Warnings } from './migrate-studio';
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

/**
 * Grocery and Khatario chrome, as their old shells paint it (D31):
 * - Grocery: a scrolling announcement (custom text, else the tagline) and the footer on scheme 6; the header shows
 *   category chips while categories are on, and its menu is All Products plus Offers while offers are on.
 * - Khatario: the announcement (custom text only) and the header on scheme 4; the default footer.
 * An announcement with no text is kept switched off. Custom announcement colours are applied by the caller.
 */
function packChrome(
  t: StoreTheme,
  ctx: MigrationContext,
  header: Section,
  footer: Section,
  w: Warnings,
): { header: Template; footer: Template } {
  const grocery = t.pack === 'grocery';
  const text = resolveAnnouncementText(t, grocery ? ctx.tagline : '');
  if (text.length > 200) w.add('The announcement text was shortened to 200 characters.');
  const raw: Record<string, unknown> = { text, text_align: t.announcement_align };
  if (grocery) raw.scrolling = true;
  if (t.announcement_link) {
    const link = engineUrl(t.announcement_link);
    if (link) raw.link = link;
    else w.add('The announcement link was dropped: the new theme only takes https or same-store links.');
  }
  const announcement: Section = { ...engineSection('announcement', raw), color_scheme: grocery ? 'scheme-6' : 'scheme-4' };
  if (!text) announcement.disabled = true;

  let head: Section;
  if (grocery) {
    const links = [
      { type: 'menu_link', settings: { label: 'All Products', link: '/catalog' } },
      ...(sectionEnabled(t, 'offers') ? [{ type: 'menu_link', settings: { label: 'Offers', link: '/catalog?disc=10' } }] : []),
    ];
    const rebuilt = engineSection('header', { ...header.settings, show_category_chips: sectionEnabled(t, 'categories') }, links);
    head = { ...header, settings: rebuilt.settings, blocks: rebuilt.blocks, block_order: rebuilt.block_order };
  } else {
    head = { ...header, color_scheme: 'scheme-4' };
  }
  const foot: Section = grocery ? { ...footer, color_scheme: 'scheme-6' } : footer;
  return { header: template([announcement, head]), footer: template([foot]) };
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
  // Grocery and Khatario take only the header and footer from the Studio view; their announcement and home are
  // mapped apart.
  const sections = studioLike
    ? resolveStudioSections(t, studioCtx)
    : themeToStudioSections(t, studioCtx).filter((s) => s.type === 'header' || s.type === 'footer');
  const groups = migrateStudioSections(sections, t, ctx);
  for (const m of groups.warnings) w.add(m);

  let home = groups.home;
  let headerGroup = groups.header;
  let footerGroup = groups.footer;
  if (!studioLike) {
    const pack = migratePackHome(t, ctx);
    home = pack.home;
    for (const m of pack.warnings) w.add(m);
    const chrome = packChrome(t, ctx, groups.header.sections.header, groups.footer.sections.footer, w);
    headerGroup = chrome.header;
    footerGroup = chrome.footer;
  }

  // D31: custom announcement colours replace scheme 5, renamed "Announcement", and the bar uses it.
  const announcement = headerGroup.sections.announcement;
  const annSrc = sections.find((s) => s.type === 'announcement');
  const bg = annSrc ? annSrc.settings.background ?? '' : t.announcement_bg;
  const fg = annSrc ? annSrc.settings.textColor ?? '' : t.announcement_fg;
  if (announcement && (bg || fg)) {
    settings.color_schemes[4] = announcementScheme(settings.color_schemes[4], t.accent, bg, fg);
    announcement.color_scheme = settings.color_schemes[4].id;
  }

  const data: ThemeData = {
    settings,
    header_group: headerGroup,
    footer_group: footerGroup,
    templates: {
      home,
      product: { order: [], sections: {} },
      catalog: { order: [], sections: {} },
    },
  };
  return { preset: t.pack, name: STORE_THEME_PRESETS[t.pack].label, data, warnings: w.all() };
}
