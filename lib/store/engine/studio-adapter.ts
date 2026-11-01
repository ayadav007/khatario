import type {
  StudioHeroSettings,
  StudioProductSource,
  StudioSettings,
  StudioSlide,
  StudioUsp,
  StudioUspIcon,
} from '@/lib/store/studio-sections';
import { STUDIO_PRODUCT_SOURCES, STUDIO_USP_ICONS } from '@/lib/store/studio-sections';
import { getSectionSchema } from './registry';
import { defaultSettings } from './settings';
import type { Block, Section } from './types';

type Raw = Record<string, unknown>;

const MAX_EXTRA_SLIDES = 5;

/** Stored settings over the section schema's defaults (stored themes do not carry defaults). */
function settingsOf(section: Section): Raw {
  const schema = getSectionSchema(section.type);
  return { ...(schema ? defaultSettings(schema.settings) : {}), ...(section.settings ?? {}) };
}

/** Enabled blocks of one type, in `block_order`, each merged over the block schema's defaults. */
function blocksOf(section: Section, type: string): Raw[] {
  const schema = getSectionSchema(section.type)?.blocks?.find((b) => b.type === type);
  const defaults = schema ? defaultSettings(schema.settings) : {};
  const out: Raw[] = [];
  for (const id of section.block_order ?? []) {
    const block: Block | undefined = section.blocks?.[id];
    if (!block || block.disabled || block.type !== type) continue;
    out.push({ ...defaults, ...(block.settings ?? {}) });
  }
  return out;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
function pick<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function toStudioBox(section: Section): Pick<StudioSettings, 'spacingTop' | 'spacingBottom'> {
  const s = settingsOf(section);
  const box: Pick<StudioSettings, 'spacingTop' | 'spacingBottom'> = {};
  const top = num(s.spacing_top);
  const bottom = num(s.spacing_bottom);
  if (top !== undefined) box.spacingTop = top;
  if (bottom !== undefined) box.spacingBottom = bottom;
  return box;
}

const HEADING_SIZES = ['small', 'medium', 'large', 'xl', 'xxl'] as const;
const BUTTON_STYLES = ['filled', 'outline'] as const;
const ALIGNS = ['left', 'center', 'right'] as const;
const POSITIONS = ['top', 'middle', 'bottom'].flatMap((row) => ALIGNS.map((col) => `${row}-${col}`));
const HEX = /^#[0-9a-f]{3,8}$/i;

/**
 * One slide block, look included. Every slide carries its own value for each setting (so a slide never takes
 * another's darkening or colours); the phone image, text colour and scheme are left out when empty.
 */
function toSlide(b: Raw): StudioSlide {
  const textColor = str(b.text_color);
  const scheme = str(b.color_scheme);
  return {
    image: str(b.image),
    ...(str(b.mobile_image) ? { mobileImage: str(b.mobile_image) } : {}),
    heading: str(b.heading),
    description: str(b.description),
    buttonText: str(b.button_text),
    link: str(b.link),
    eyebrow: str(b.eyebrow),
    headingSize: pick(b.heading_size, HEADING_SIZES) ?? 'large',
    buttonStyle: pick(b.button_style, BUTTON_STYLES) ?? 'filled',
    button2Text: str(b.button_2_text),
    button2Link: str(b.button_2_link),
    button2Style: pick(b.button_2_style, BUTTON_STYLES) ?? 'filled',
    position: pick(b.position, POSITIONS) ?? 'middle-left',
    align: pick(b.align, ALIGNS) ?? 'left',
    alignMobile: pick(b.align_mobile, ALIGNS) ?? 'left',
    box: bool(b.box, false),
    overlay: Math.min(80, Math.max(0, num(b.overlay) ?? 0)),
    ...(HEX.test(textColor) ? { textColor } : {}),
    // Passed through as stored: the section component looks it up in the theme's schemes.
    ...(scheme ? { colorScheme: scheme } : {}),
  };
}

export type SlideDevice = 'both' | 'mobile' | 'desktop';

/** Each slide's device, in the same order as `slideshowSettings` lays the slides out. */
export function slideshowDevices(section: Section): SlideDevice[] {
  return blocksOf(section, 'slide')
    .slice(0, 1 + MAX_EXTRA_SLIDES)
    .map((b) => pick(b.device, ['both', 'mobile', 'desktop'] as const) ?? 'both');
}

/** Slide one's picture, words and look are the hero's own fields; `slides` holds the rest, each with its own look. */
export function slideshowSettings(section: Section): StudioHeroSettings {
  const s = settingsOf(section);
  const [first, ...rest] = blocksOf(section, 'slide').map(toSlide);
  const speed = num(s.speed) ?? 5;
  const out: StudioHeroSettings = {
    ...toStudioBox(section),
    autoplay: bool(s.autoplay, true) ? speed : 0,
    layout: pick(s.layout, ['full', 'image-text', 'text-image'] as const) ?? 'image-text',
    height: pick(s.height, ['small', 'medium', 'large'] as const) ?? 'medium',
    imageFit: pick(s.image_fit, ['cover', 'contain', 'natural'] as const) ?? 'cover',
    textBelowMobile: bool(s.text_below_mobile, false),
    ...(first ?? {}),
  };
  const slides = rest.slice(0, MAX_EXTRA_SLIDES);
  if (slides.length) out.slides = slides;
  return out;
}

export function multicolumnSettings(section: Section): StudioSettings {
  const s = settingsOf(section);
  const usps: StudioUsp[] = blocksOf(section, 'column').map((b) => ({
    icon: pick<StudioUspIcon>(b.icon, STUDIO_USP_ICONS) ?? 'badge',
    title: str(b.title),
    text: str(b.text),
    ...(str(b.image) ? { image: str(b.image) } : {}),
  }));
  return { ...toStudioBox(section), title: str(s.heading), usps };
}

export function marqueeSettings(section: Section): StudioSettings {
  const s = settingsOf(section);
  const text = blocksOf(section, 'item')
    .map((b) => str(b.text).replace(/,/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(', ');
  // Engine speed is seconds per loop (lower = faster); Studio has three steps.
  const secs = num(s.speed) ?? 30;
  const speed: StudioSettings['speed'] = secs <= 24 ? 'fast' : secs >= 48 ? 'slow' : 'normal';
  return { ...toStudioBox(section), text, speed };
}

export function testimonialItems(
  section: Section,
): { text: string; name: string; photo: string; rating: number; title: string; location: string; purchased: string }[] {
  return blocksOf(section, 'quote').map((b) => ({
    text: str(b.text),
    name: str(b.name),
    photo: str(b.photo),
    title: str(b.title),
    location: str(b.location),
    purchased: str(b.purchased),
    rating: Math.min(5, Math.max(1, Math.round(num(b.rating) ?? 5))),
  }));
}

export function productSectionSettings(section: Section): StudioSettings {
  const s = settingsOf(section);
  const out: StudioSettings = {
    ...toStudioBox(section),
    title: str(s.heading),
    eyebrow: str(s.eyebrow),
    source: pick<StudioProductSource>(s.source, STUDIO_PRODUCT_SOURCES) ?? 'all',
    cardStyle: pick(s.card_style, ['bordered', 'shadow', 'minimal'] as const) ?? 'bordered',
    showRating: bool(s.show_rating, true),
    showBadges: bool(s.show_badges, true),
    showTagline: bool(s.show_tagline, false),
    showSwatches: bool(s.show_swatches, false),
  };
  const limit = num(s.limit);
  if (limit !== undefined) out.limit = limit;
  const columns = num(s.columns);
  if (columns !== undefined) out.columns = columns;
  if (typeof s.category === 'string' && s.category) out.categoryId = s.category;
  const priceMax = num(s.price_max);
  if (priceMax !== undefined) out.priceMax = priceMax;
  return out;
}

export function announcementSettings(section: Section): StudioSettings {
  const s = settingsOf(section);
  return {
    ...toStudioBox(section),
    announceMode: 'custom',
    text: str(s.text),
    link: str(s.link),
    textAlign: pick(s.text_align, ['left', 'center', 'right'] as const) ?? 'center',
  };
}
