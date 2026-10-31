// Server-only (imports the engine sanitiser through settings.ts). Pure: no db, no clock, no randomness.
import type { StoreTheme } from '@/lib/store/store-theme';
import type { StudioSection } from '@/lib/store/studio-sections';
import { sanitizeCssClass, SECTION_CSS_MAX } from '@/lib/store/studio-sections';
import { splitList, studioEyebrow, studioLinkTarget, themeToStudioSections, type StudioContext } from '@/lib/store/studio-layout';
import { getSectionSchema } from './registry';
import { sanitizeSettings, sanitizeSettingValue } from './settings';
import { ENGINE_LIMITS } from './shared';
import { block, section, template } from './presets/shared';
import { STUDIO_USPS } from './presets/studio';
import type { Block, Section, Template } from './types';
import type { MigrationContext } from './migrate';

type Raw = Record<string, unknown>;

/** Collects warnings once each, in the order they were first raised. */
export class Warnings {
  private list: string[] = [];
  add(message: string): void {
    if (!this.list.includes(message)) this.list.push(message);
  }
  all(): string[] {
    return [...this.list];
  }
}

const IMAGE_SCHEMA = { id: 'image', type: 'image', label: 'Image' } as const;
const URL_SCHEMA = { id: 'url', type: 'url', label: 'URL' } as const;

/** The image when the engine image rule keeps it (https or root-relative), else '' plus one warning per kind. */
export function keepImage(value: string | undefined, kind: string, w: Warnings): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  const out = sanitizeSettingValue(IMAGE_SCHEMA, v);
  if (typeof out === 'string' && out) return out;
  w.add(`The ${kind} was left out: the new theme only takes https or same-store images.`);
  return '';
}

/** The link when the engine url rule keeps it, else ''. */
export function engineUrl(value: string | undefined): string {
  const out = sanitizeSettingValue(URL_SCHEMA, (value ?? '').trim());
  return typeof out === 'string' ? out : '';
}

/** HTML-escapes merchant text (`& < > " '`). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain text as `<p>` paragraphs (blank lines split paragraphs, single newlines become `<br>`). */
export function textToParagraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\s*\n\s*/g, '<br>')}</p>`)
    .join('');
}

/** A section whose settings and blocks are already what the engine sanitiser keeps. */
export function engineSection(type: string, raw: Raw, rawBlocks: Array<{ type: string; settings: Raw }> = []): Section {
  const schema = getSectionSchema(type);
  if (!schema) throw new Error(`unknown section type ${type}`);
  const cap = Math.min(schema.max_blocks ?? ENGINE_LIMITS.blocksPerSection, ENGINE_LIMITS.blocksPerSection);
  const perType: Record<string, number> = {};
  const out: Block[] = [];
  for (const b of rawBlocks) {
    if (out.length >= cap) break;
    const bs = schema.blocks?.find((x) => x.type === b.type);
    if (!bs) continue;
    const used = perType[b.type] ?? 0;
    if (bs.limit !== undefined && used >= bs.limit) continue;
    perType[b.type] = used + 1;
    out.push(block(b.type, sanitizeSettings(bs.settings, b.settings)));
  }
  return section(type, sanitizeSettings(schema.settings, raw), out);
}

/**
 * A header or footer carrying the old `menu_link` / `link_column` blocks, raw. Their schemas no longer declare those
 * types (so `engineSection` would drop them); the one-time conversion in `convertLegacyMenus` turns them into menus.
 * Ids are the preset ones (`menu-link-1`, `link-column-1`).
 */
export function withLegacyBlocks(target: Section, legacy: Array<{ type: string; settings: Raw }>): Section {
  const built = section(target.type, target.settings, legacy.map((b) => block(b.type, b.settings)));
  return { ...target, blocks: built.blocks, block_order: built.block_order };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/** Studio's free-text label → an engine link (D32), or null when the link cannot be kept. */
export function labelLink(label: string, ctx: MigrationContext, w: Warnings, where: string): string | null {
  const target = studioLinkTarget(label, ctx.categories);
  switch (target.kind) {
    case 'products':
      return '/catalog';
    case 'offers':
      return '/catalog?disc=10';
    case 'category':
      return `/catalog/${target.id}`;
    default: {
      // A typed address is kept when the engine's link rule takes it (same-store or https), as the old store
      // linked it; an http or malformed one is dropped.
      const href = engineUrl(target.href);
      if (href) return href;
      w.add(`The ${where} link "${label.slice(0, 80)}" was dropped: the new theme only takes https or same-store links.`);
      return null;
    }
  }
}

/** The old Quick store padded each home section 12-16px; the engine default is 32px. */
export const QUICK_SECTION_SPACING = 12;

/** Quick's rhythm for the spacing the merchant never set (a set value is kept). */
function quickSpacing(out: Section, src: StudioSection): void {
  const s = src.settings;
  out.settings = {
    ...out.settings,
    ...(typeof s.spacingTop === 'number' ? {} : { spacing_top: QUICK_SECTION_SPACING }),
    ...(typeof s.spacingBottom === 'number' ? {} : { spacing_bottom: QUICK_SECTION_SPACING }),
  };
}

/** Common wrapper fields: hidden, class names, section CSS, spacing and the Studio name. */
function common(target: Section, src: StudioSection, kind: 'home' | 'group'): Section {
  const s = src.settings;
  const out: Section = { ...target };
  if (src.enabled === false) out.disabled = true;
  const label = (src.name ?? '').trim().slice(0, 40);
  if (label) out.label = label;
  const cls = sanitizeCssClass(s.cssClass);
  if (cls) out.css_class = cls;
  if (typeof s.customCss === 'string') {
    const css = s.customCss.slice(0, SECTION_CSS_MAX).replace(/</g, '');
    if (css) out.custom_css = css;
  }
  if (kind === 'home') {
    const schema = getSectionSchema(target.type)!;
    const spacing = sanitizeSettings(schema.settings, { spacing_top: s.spacingTop, spacing_bottom: s.spacingBottom });
    out.settings = { ...out.settings, ...spacing };
  }
  return out;
}

function warnColours(src: StudioSection, w: Warnings): void {
  if (src.settings.background || src.settings.textColor) {
    w.add('Section background and text colours are not carried over; pick a colour scheme in Studio 2.');
  }
}

function migrateAnnouncement(src: StudioSection, w: Warnings): Section {
  const s = src.settings;
  const auto = s.announceMode === 'auto';
  const text = (auto ? s.autoText ?? '' : s.text ?? '').trim();
  if (text.length > 200) w.add('The announcement text was shortened to 200 characters.');
  if (!auto && s.extra && s.extra.trim()) w.add('The announcement second line is not carried over.');
  const raw: Raw = { text, text_align: s.textAlign ?? 'center' };
  if (s.link) {
    const link = engineUrl(s.link);
    if (link) raw.link = link;
    else w.add('The announcement link was dropped: the new theme only takes https or same-store links.');
  }
  const out = common(engineSection('announcement', raw), src, 'group');
  if (!text) out.disabled = true;
  return out;
}

function migrateHeader(src: StudioSection, t: StoreTheme, ctx: MigrationContext, w: Warnings): Section {
  const s = src.settings;
  const raw: Raw = {
    show_search: s.showSearch ?? true,
    icons_position: s.iconsPosition ?? 'right',
    show_account: s.showAccount ?? true,
    show_cart: s.showCart ?? true,
    show_cart_count: s.showCartCount ?? true,
  };
  if (t.search_placeholder) raw.search_placeholder = t.search_placeholder;
  const eta = (s.deliveryEta ?? '').trim();
  const tagline = (s.tagline ?? '').trim();
  if (eta) raw.delivery_eta = eta;
  else if (tagline) {
    if (tagline.length > 40) w.add('The header tagline was shortened to 40 characters.');
    raw.delivery_eta = tagline.slice(0, 40).trim();
  }
  if (s.logo && s.logo.trim() && s.logo.trim() !== ctx.businessName.trim()) {
    w.add('The header logo text is not carried over; the header shows the store name.');
  }
  if (s.accountIcon || s.accountIconSvg || s.cartIcon || s.cartIconSvg) {
    w.add('Custom header icons are not carried over.');
  }
  warnColours(src, w);
  const links: Array<{ type: string; settings: Raw }> = [];
  if (s.showNav !== false) {
    const highlight = (s.highlightLink ?? '').trim().toLowerCase();
    for (const label of splitList(s.navLinks, 'All Products')) {
      if (links.length >= 12) {
        w.add('Only the first 12 menu links are carried over.');
        break;
      }
      const link = labelLink(label, ctx, w, 'menu');
      if (link === null) continue;
      links.push({ type: 'menu_link', settings: { label, link, highlight: !!highlight && label.toLowerCase() === highlight } });
    }
  }
  return common(withLegacyBlocks(engineSection('header', raw), links), src, 'group');
}

function migrateFooter(src: StudioSection, ctx: MigrationContext, w: Warnings): Section {
  const s = src.settings;
  const raw: Raw = {};
  if (s.tagline) raw.about = s.tagline;
  const lines: string[] = [];
  for (const label of splitList(s.links, 'Shop, About, Contact, Privacy')) {
    const clean = label.replace(/[|\r\n]/g, ' ').trim();
    if (!clean) continue;
    const link = clean.toLowerCase() === 'shop' ? '/' : labelLink(clean, ctx, w, 'footer');
    if (link === null) continue;
    lines.push(`${clean}|${link}`);
  }
  warnColours(src, w);
  const blocks = lines.length ? [{ type: 'link_column', settings: { heading: 'Links', links: lines.join('\n') } as Raw }] : [];
  return common(withLegacyBlocks(engineSection('footer', raw), blocks), src, 'group');
}

function migrateHero(src: StudioSection, w: Warnings): Section {
  const s = src.settings;
  const interval = s.autoplay ?? 6;
  const raw: Raw = { layout: s.layout ?? 'image-text', height: s.height ?? 'medium', autoplay: interval > 0 };
  if (interval > 0) raw.speed = clamp(interval, 3, 10);
  if ((s.eyebrow ?? '').trim() || (s.benefits ?? '').trim() || (s.align && s.align !== 'left') || (s.overlay !== undefined && s.overlay !== 20 && s.overlay !== 35)) {
    w.add('Hero eyebrow, highlights, alignment and image shade are not carried over.');
  }
  warnColours(src, w);
  const slides = [
    { image: s.image, heading: s.heading, description: s.description, buttonText: s.buttonText, link: s.link },
    ...(s.slides ?? []),
  ].slice(0, 6);
  // The old Studio hero (Studio and Quick stores) showed every slide on every device and never read
  // `hero_slides[].viewport`, so every migrated slide is for both devices.
  const blocks = slides.map((sl) => {
    const link = sl.link ? engineUrl(sl.link) : '';
    return {
      type: 'slide',
      settings: {
        image: keepImage(sl.image, 'hero image', w),
        heading: sl.heading ?? '',
        description: sl.description ?? '',
        button_text: sl.buttonText ?? '',
        link: link || '#catalog',
        device: 'both',
      } as Raw,
    };
  });
  return common(engineSection('slideshow', raw, blocks), src, 'home');
}

const CATEGORY_STYLE = { letter: 'tiles', icon: 'cards', photo: 'tiles' } as const;

function migrateCategories(src: StudioSection, t: StoreTheme, ctx: MigrationContext, w: Warnings): Section {
  const s = src.settings;
  const raw: Raw = {
    heading: s.title ?? '',
    eyebrow: studioEyebrow('categories', s.eyebrow),
    columns: clamp(s.columns ?? 6, 3, 8),
    style: CATEGORY_STYLE[t.category_style] ?? 'tiles',
  };
  warnColours(src, w);
  const blocks: Array<{ type: string; settings: Raw }> = [];
  for (const c of ctx.categories) {
    const url = t.category_images[c.id];
    if (!url) continue;
    const image = keepImage(url, 'category image', w);
    if (image) blocks.push({ type: 'category_image', settings: { category: c.id, image } });
  }
  return common(engineSection('category-grid', raw, blocks), src, 'home');
}

function migrateProducts(src: StudioSection, w: Warnings): Section {
  const s = src.settings;
  const source = s.source ?? 'all';
  const raw: Raw = {
    heading: s.title ?? '',
    eyebrow: studioEyebrow('products', s.eyebrow, source),
    source,
    limit: source === 'all' ? 24 : clamp(s.limit ?? 8, 2, 24),
    columns: clamp(s.columns ?? 5, 2, 6),
    card_style: s.cardStyle ?? 'bordered',
    show_rating: s.showRating ?? true,
    show_badges: s.showBadges ?? true,
  };
  if (source === 'category') {
    raw.category = s.categoryId ?? '';
    if (sanitizeSettingValue({ id: 'category', type: 'category', label: 'Category' }, s.categoryId) === undefined) {
      w.add(`The product row "${(s.title ?? src.name).slice(0, 60)}" has no valid category; pick one in Studio 2.`);
    }
  }
  if (source === 'price_max') raw.price_max = s.priceMax ?? 499;
  if (s.imageRatio && s.imageRatio !== 'square') w.add('Product image shape is not carried over.');
  warnColours(src, w);
  return common(engineSection(s.display === 'carousel' ? 'product-rail' : 'featured-products', raw), src, 'home');
}

function migrateBanner(src: StudioSection, w: Warnings): Section {
  const s = src.settings;
  const link = s.link ? engineUrl(s.link) : '';
  warnColours(src, w);
  return common(
    engineSection('image-banner', {
      image: keepImage(s.image, 'banner image', w),
      heading: s.title ?? '',
      description: s.text ?? '',
      button_text: s.button ?? '',
      link: link || '#catalog',
      height: s.height ?? 'medium',
      text_position: s.textAlign ?? 'left',
    }),
    src,
    'home',
  );
}

function migrateTestimonials(src: StudioSection, t: StoreTheme, w: Warnings): Section {
  warnColours(src, w);
  const blocks = t.testimonials.map((q) => {
    if (q.text.length > 400) w.add('Testimonials longer than 400 characters were shortened.');
    return { type: 'quote', settings: { text: q.text, name: q.name, photo: keepImage(q.photo_url, 'testimonial photo', w), rating: 5 } as Raw };
  });
  return common(engineSection('testimonials', { heading: src.settings.title ?? '' }, blocks), src, 'home');
}

function migrateRichText(src: StudioSection, w: Warnings): Section {
  const s = src.settings;
  warnColours(src, w);
  return common(
    engineSection('rich-text', { heading: s.title ?? '', content: textToParagraphs(s.text ?? ''), align: s.textAlign ?? 'center' }),
    src,
    'home',
  );
}

function migrateUsp(src: StudioSection, w: Warnings): Section {
  const s = src.settings;
  warnColours(src, w);
  const usps = s.usps ?? STUDIO_USPS;
  const raw: Raw = s.title ? { heading: s.title } : {};
  return common(
    engineSection('multicolumn', raw, usps.map((u) => ({ type: 'column', settings: { icon: u.icon, title: u.title, text: u.text } }))),
    src,
    'home',
  );
}

const MARQUEE_SECONDS = { slow: 48, normal: 30, fast: 18 } as const;

function migrateMarquee(src: StudioSection, w: Warnings): Section {
  const s = src.settings;
  warnColours(src, w);
  const items = splitList(s.text, '');
  if (items.length > 12) w.add('Only the first 12 scrolling text items are carried over.');
  return common(
    engineSection(
      'marquee',
      { speed: MARQUEE_SECONDS[s.speed ?? 'normal'] },
      items.map((text) => ({ type: 'item', settings: { text } })),
    ),
    src,
    'home',
  );
}

/** Whether a derived (never-customised) section that is switched off still holds merchant content worth keeping. */
function derivedHasContent(src: StudioSection, t: StoreTheme): boolean {
  switch (src.type) {
    case 'hero':
      return t.hero_slides.length > 0;
    case 'banner':
      return t.overlay_bands.length > 0;
    case 'testimonials':
      return t.testimonials.length > 0;
    case 'categories':
      return Object.keys(t.category_images).length > 0;
    default:
      return false;
  }
}

function homeSection(src: StudioSection, t: StoreTheme, ctx: MigrationContext, w: Warnings): Section | null {
  switch (src.type) {
    case 'hero':
      return migrateHero(src, w);
    case 'categories':
      return migrateCategories(src, t, ctx, w);
    case 'products':
      return migrateProducts(src, w);
    case 'banner':
      return migrateBanner(src, w);
    case 'testimonials':
      return migrateTestimonials(src, t, w);
    case 'richtext':
      return migrateRichText(src, w);
    case 'usp':
      return migrateUsp(src, w);
    case 'marquee':
      return migrateMarquee(src, w);
    default:
      return null;
  }
}

export function studioContextFor(ctx: MigrationContext): StudioContext {
  return { businessName: ctx.businessName, tagline: ctx.tagline, heroUrl: ctx.heroUrl, categories: ctx.categories, autoAnnouncement: '' };
}

/**
 * One engine section per Studio section (D30 ids). Announcement and header go to the header group, footer to the
 * footer group, everything else to the home template (capped at 25).
 */
export function migrateStudioSections(
  sections: StudioSection[],
  t: StoreTheme,
  ctx: MigrationContext,
): { header: Template; footer: Template; home: Template; warnings: string[] } {
  const w = new Warnings();
  const derived = t.studio_sections.length === 0;
  const fallback = themeToStudioSections(t, studioContextFor(ctx));
  const find = (list: StudioSection[], type: StudioSection['type']) => list.find((s) => s.type === type);

  const announcementSrc = find(sections, 'announcement');
  const headerSrc = find(sections, 'header') ?? find(fallback, 'header')!;
  const footerSrc = find(sections, 'footer') ?? find(fallback, 'footer')!;

  const headerSections: Section[] = [];
  if (announcementSrc) headerSections.push(migrateAnnouncement(announcementSrc, w));
  headerSections.push(migrateHeader(headerSrc, t, ctx, w));

  const homeSections: Section[] = [];
  for (const src of sections) {
    if (src.type === 'announcement' || src.type === 'header' || src.type === 'footer') continue;
    // A derived section that is switched off and holds nothing of the merchant's is left out, as the store never showed it.
    if (derived && src.enabled === false && !derivedHasContent(src, t)) continue;
    const s = homeSection(src, t, ctx, w);
    if (s && t.pack === 'quick') quickSpacing(s, src);
    if (s) homeSections.push(s);
  }
  const max = ENGINE_LIMITS.sectionsPerTemplate;
  if (homeSections.length > max) {
    const over = homeSections.length - max;
    w.add(`${over} ${over === 1 ? 'section' : 'sections'} past the ${max}-section limit ${over === 1 ? 'was' : 'were'} not carried over.`);
  }

  return {
    header: template(headerSections),
    footer: template([migrateFooter(footerSrc, ctx, w)]),
    home: template(homeSections.slice(0, max)),
    warnings: w.all(),
  };
}
