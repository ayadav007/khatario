// Client-safe: no server imports. The store product card: settings, defaults, sanitiser, the ten designs and the
// pure helpers the cards and the editor share (spec: docs/superpowers/specs/2026-11-01-store-product-cards-design.md).
import { ID_RE, isHexColor, normaliseLineList, sanitizeImageLink } from './shared';

export const CARD_LINE_IDS = ['brand', 'name', 'unit', 'rating', 'tagline', 'price', 'swatches', 'buttons'] as const;
export type CardLineId = (typeof CARD_LINE_IDS)[number];
export interface CardLine {
  id: CardLineId;
  on: boolean;
}

export const CARD_DESIGN_IDS = ['classic', 'minimal', 'grocery', 'boutique', 'list', 'royal', 'deal', 'soft', 'editorial', 'dark'] as const;
export type CardDesignId = (typeof CARD_DESIGN_IDS)[number];

/** Names for the gallery and the section's Card select. */
export const CARD_DESIGN_LABELS: Record<CardDesignId | 'theme', string> = {
  theme: "Theme's own",
  classic: 'Classic',
  minimal: 'Minimal',
  grocery: 'Grocery app',
  boutique: 'Boutique',
  list: 'List',
  royal: 'Royal',
  deal: 'Deal',
  soft: 'Soft',
  editorial: 'Editorial',
  dark: 'Dark',
};

export interface ProductCardSettings {
  design: 'theme' | CardDesignId;
  // Lines
  lines: CardLine[];
  name_price_row: boolean;
  name_font: 'heading' | 'body';
  name_case: 'normal' | 'caps';
  name_lines: 1 | 2;
  name_size: 's' | 'm' | 'l';
  rating_style: 'stars' | 'number' | 'count';
  // Price
  price_size: 's' | 'm' | 'l';
  price_color: 'text' | 'accent';
  show_mrp: boolean;
  discount_style: 'none' | 'text' | 'pill' | 'save';
  // Photo
  image_shape: 'square' | 'portrait' | 'landscape' | 'natural';
  image_fit: 'fill' | 'contain';
  image_padding: number; // 0-24
  image_radius: number; // 0-32
  image_bg: string; // hex or ''
  image_hover: 'none' | 'second' | 'zoom';
  image_swipe: boolean;
  placeholder: 'initial' | 'logo' | 'icon';
  // Badges
  badge_shape: 'pill' | 'ribbon' | 'corner';
  badge_position: 'top-left' | 'top-right';
  badge_icon: 'none' | 'crown' | 'star' | 'flame' | 'sparkle';
  badge_colors: 'accent' | 'button';
  // Buttons
  button_style: 'full' | 'pill_on_photo' | 'icon' | 'icon_full' | 'none';
  button_fill: 'filled' | 'outline';
  button_shape: 'rounded' | 'pill';
  /** `hover`: the button appears on hover on devices with a mouse; touch screens always show it. */
  button_reveal: 'always' | 'hover';
  button_action: 'add' | 'buy';
  after_add: 'button' | 'stepper';
  wishlist: 'off' | 'top-left' | 'top-right';
  wishlist_bg: 'plain' | 'circle';
  // Card
  /** Beyond spec §2: `row` puts the photo left and the details right (the List design); `stack` is photo on top. */
  layout: 'stack' | 'row';
  color_scheme: string; // scheme id or '' (the section's colours)
  border: number; // 0-3
  radius: number; // 0-32
  shadow: 'none' | 'soft' | 'strong';
  align: 'left' | 'center';
  padding: number; // 0-24
  background_image: string; // image link or ''
  hover: 'none' | 'lift' | 'zoom';
  // Out of stock
  oos_look: 'label' | 'faded' | 'soldout_button';
  oos_place: 'stay' | 'end' | 'hide';
}

/** Today's card: brand off (the card has none), everything else shown when the product has it. */
const DEFAULT_LINES: readonly CardLine[] = [
  { id: 'brand', on: false },
  { id: 'name', on: true },
  { id: 'unit', on: true },
  { id: 'rating', on: true },
  { id: 'tagline', on: true },
  { id: 'price', on: true },
  { id: 'swatches', on: true },
  { id: 'buttons', on: true },
];

export const PRODUCT_CARD_DEFAULTS: ProductCardSettings = {
  design: 'theme',
  lines: DEFAULT_LINES.map((l) => ({ ...l })),
  name_price_row: false,
  name_font: 'body',
  name_case: 'normal',
  name_lines: 2,
  name_size: 'm',
  rating_style: 'number',
  price_size: 'm',
  price_color: 'text',
  show_mrp: true,
  discount_style: 'text',
  image_shape: 'square',
  image_fit: 'fill',
  image_padding: 0,
  image_radius: 0,
  image_bg: '',
  image_hover: 'none',
  image_swipe: false,
  placeholder: 'initial',
  badge_shape: 'pill',
  badge_position: 'top-left',
  badge_icon: 'none',
  badge_colors: 'accent',
  button_style: 'full',
  button_fill: 'filled',
  button_shape: 'rounded',
  button_reveal: 'always',
  button_action: 'add',
  after_add: 'stepper',
  wishlist: 'top-right',
  wishlist_bg: 'plain',
  layout: 'stack',
  color_scheme: '',
  border: 0,
  radius: 12,
  shadow: 'none',
  align: 'left',
  padding: 12,
  background_image: '',
  hover: 'none',
  oos_look: 'label',
  oos_place: 'stay',
};

/** A copy that shares nothing with `card` (the lines are the only nested value). */
export function cloneProductCard(card: ProductCardSettings): ProductCardSettings {
  return { ...card, lines: card.lines.map((l) => ({ ...l })) };
}

// ---- Sanitiser ----

const ENUMS = {
  design: ['theme', ...CARD_DESIGN_IDS],
  name_font: ['heading', 'body'],
  name_case: ['normal', 'caps'],
  name_size: ['s', 'm', 'l'],
  rating_style: ['stars', 'number', 'count'],
  price_size: ['s', 'm', 'l'],
  price_color: ['text', 'accent'],
  discount_style: ['none', 'text', 'pill', 'save'],
  image_shape: ['square', 'portrait', 'landscape', 'natural'],
  image_fit: ['fill', 'contain'],
  image_hover: ['none', 'second', 'zoom'],
  placeholder: ['initial', 'logo', 'icon'],
  badge_shape: ['pill', 'ribbon', 'corner'],
  badge_position: ['top-left', 'top-right'],
  badge_icon: ['none', 'crown', 'star', 'flame', 'sparkle'],
  badge_colors: ['accent', 'button'],
  button_style: ['full', 'pill_on_photo', 'icon', 'icon_full', 'none'],
  button_fill: ['filled', 'outline'],
  button_shape: ['rounded', 'pill'],
  button_reveal: ['always', 'hover'],
  button_action: ['add', 'buy'],
  after_add: ['button', 'stepper'],
  wishlist: ['off', 'top-left', 'top-right'],
  wishlist_bg: ['plain', 'circle'],
  layout: ['stack', 'row'],
  shadow: ['none', 'soft', 'strong'],
  align: ['left', 'center'],
  hover: ['none', 'lift', 'zoom'],
  oos_look: ['label', 'faded', 'soldout_button'],
  oos_place: ['stay', 'end', 'hide'],
} as const;

type EnumKey = keyof typeof ENUMS;
const BOOLEANS = ['name_price_row', 'show_mrp', 'image_swipe'] as const;
const RANGES = {
  image_padding: [0, 24],
  image_radius: [0, 32],
  border: [0, 3],
  radius: [0, 32],
  padding: [0, 24],
} as const;

const SCHEME_ID_RE = ID_RE;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Clean a theme's `product_card`. Each field is checked alone: a bad value takes the default, a number is rounded and
 * kept inside its range, `lines` becomes a permutation of the eight line ids. A colour scheme id the theme does not have
 * is dropped when `schemeIds` is given. Anything that is not an object gives the defaults. Always returns a fresh object.
 */
export function sanitizeProductCard(raw: unknown, schemeIds?: ReadonlySet<string>): ProductCardSettings {
  const r = isObject(raw) ? raw : {};
  const out = cloneProductCard(PRODUCT_CARD_DEFAULTS) as unknown as Record<string, unknown>;
  for (const key of Object.keys(ENUMS) as EnumKey[]) {
    if ((ENUMS[key] as readonly unknown[]).includes(r[key])) out[key] = r[key];
  }
  for (const key of BOOLEANS) if (typeof r[key] === 'boolean') out[key] = r[key];
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const v = r[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = Math.min(max, Math.max(min, Math.round(v)));
  }
  if (r.name_lines === 1 || r.name_lines === 2) out.name_lines = r.name_lines;
  if (typeof r.image_bg === 'string' && (r.image_bg === '' || isHexColor(r.image_bg))) out.image_bg = r.image_bg;
  const picture = sanitizeImageLink(r.background_image);
  if (typeof picture === 'string') out.background_image = picture;
  if (typeof r.color_scheme === 'string' && (r.color_scheme === '' || (SCHEME_ID_RE.test(r.color_scheme) && (!schemeIds || schemeIds.has(r.color_scheme))))) {
    out.color_scheme = r.color_scheme;
  }
  out.lines = normaliseLines(r.lines);
  return out as unknown as ProductCardSettings;
}

/** `lines` as every known line exactly once: unknown ids and repeats dropped, missing ids appended off. */
export function normaliseLines(raw: unknown): CardLine[] {
  return normaliseLineList(raw, CARD_LINE_IDS, DEFAULT_LINES) as CardLine[];
}

// ---- The ten designs ----

function lineSet(visible: readonly CardLineId[], order: readonly CardLineId[] = CARD_LINE_IDS): CardLine[] {
  const rest = CARD_LINE_IDS.filter((id) => !order.includes(id));
  return [...order, ...rest].map((id) => ({ id, on: visible.includes(id) }));
}

function design(id: CardDesignId, over: Partial<ProductCardSettings>): ProductCardSettings {
  return { ...cloneProductCard(PRODUCT_CARD_DEFAULTS), ...over, design: id };
}

/**
 * Each design is a complete settings object (data, so more can be added later). Picking one writes the whole object
 * over the current settings; the out-of-stock choices are the defaults here, so a caller keeps the store's own.
 */
export const CARD_DESIGNS: Record<CardDesignId, ProductCardSettings> = {
  // Photo on top, name, unit, price, a full-width Add button.
  classic: design('classic', {
    lines: lineSet(['name', 'unit', 'price', 'buttons']),
    border: 1,
    radius: 12,
    padding: 12,
    image_shape: 'square',
    button_style: 'full',
  }),
  // Name and price on one line; the full Add button appears on hover (always shown on touch screens).
  minimal: design('minimal', {
    lines: lineSet(['name', 'price', 'buttons']),
    name_price_row: true,
    name_lines: 1,
    price_size: 's',
    show_mrp: false,
    discount_style: 'none',
    border: 0,
    radius: 0,
    padding: 0,
    image_shape: 'square',
    button_style: 'full',
    button_reveal: 'hover',
    wishlist: 'off',
  }),
  // Square photo, a small ADD pill on it that becomes - 1 +, unit under the name, MRP crossed out.
  grocery: design('grocery', {
    lines: lineSet(['name', 'unit', 'price', 'buttons']),
    name_size: 's',
    price_size: 'm',
    show_mrp: true,
    discount_style: 'text',
    image_shape: 'square',
    image_padding: 8,
    image_radius: 12,
    image_bg: '#f4f4f5',
    image_fit: 'contain',
    button_style: 'pill_on_photo',
    after_add: 'stepper',
    wishlist: 'off',
    border: 1,
    radius: 12,
    padding: 8,
  }),
  // Tall portrait photo, second photo on hover, centred name and price, no button.
  boutique: design('boutique', {
    lines: lineSet(['name', 'price']),
    align: 'center',
    name_font: 'heading',
    image_shape: 'portrait',
    image_hover: 'second',
    button_style: 'none',
    discount_style: 'none',
    border: 0,
    radius: 0,
    padding: 8,
  }),
  // Photo left, details right, a small ADD pill on the photo, one per row.
  list: design('list', {
    layout: 'row',
    lines: lineSet(['name', 'unit', 'rating', 'price', 'buttons']),
    name_size: 's',
    image_shape: 'square',
    image_radius: 8,
    button_style: 'pill_on_photo',
    wishlist: 'off',
    border: 1,
    radius: 12,
    padding: 8,
  }),
  // The jewellery reference.
  royal: design('royal', {
    lines: lineSet(['name', 'rating', 'tagline', 'price', 'buttons'], ['brand', 'tagline', 'name', 'unit', 'rating', 'price', 'swatches', 'buttons']),
    name_font: 'heading',
    rating_style: 'count',
    price_size: 'l',
    price_color: 'accent',
    show_mrp: true,
    discount_style: 'pill',
    image_shape: 'portrait',
    image_padding: 8,
    image_radius: 12,
    image_swipe: true,
    badge_shape: 'ribbon',
    badge_position: 'top-left',
    badge_icon: 'crown',
    button_style: 'icon_full',
    button_action: 'add',
    wishlist: 'top-right',
    wishlist_bg: 'circle',
    border: 1,
    radius: 16,
    padding: 12,
  }),
  // Bold large accent price, a corner SALE badge, a discount pill and a + icon button.
  deal: design('deal', {
    lines: lineSet(['name', 'unit', 'rating', 'price', 'buttons']),
    price_size: 'l',
    price_color: 'accent',
    show_mrp: true,
    discount_style: 'pill',
    badge_shape: 'corner',
    badge_position: 'top-left',
    button_style: 'icon',
    border: 1,
    radius: 8,
    padding: 10,
    hover: 'lift',
  }),
  // Round, soft shadow, centred, a pill-shaped full button.
  soft: design('soft', {
    lines: lineSet(['name', 'unit', 'price', 'buttons']),
    align: 'center',
    image_padding: 8,
    image_radius: 18,
    button_style: 'full',
    button_shape: 'pill',
    wishlist_bg: 'circle',
    badge_shape: 'pill',
    border: 0,
    radius: 24,
    shadow: 'soft',
    padding: 12,
  }),
  // No card box: big portrait photo, small capitals name, price under, second photo on hover.
  editorial: design('editorial', {
    lines: lineSet(['name', 'price']),
    name_case: 'caps',
    name_size: 's',
    price_size: 's',
    discount_style: 'none',
    image_shape: 'portrait',
    image_hover: 'second',
    button_style: 'none',
    border: 0,
    radius: 0,
    padding: 0,
    shadow: 'none',
  }),
  // The theme's dark scheme, light text, accent price, an outline button.
  dark: design('dark', {
    lines: lineSet(['name', 'unit', 'rating', 'price', 'buttons']),
    color_scheme: 'scheme-3',
    price_color: 'accent',
    discount_style: 'text',
    image_radius: 8,
    button_style: 'full',
    button_fill: 'outline',
    border: 1,
    radius: 14,
    padding: 12,
    hover: 'lift',
  }),
};

// ---- Resolving and drawing ----

/** What the card draws: the settings that apply, with the section's switches folded in. */
export type ResolvedCardLook = ProductCardSettings & { show_badges: boolean };

export interface CardSwitches {
  rating?: boolean;
  badges?: boolean;
  tagline?: boolean;
  swatches?: boolean;
}

function isDesignId(v: unknown): v is CardDesignId {
  return typeof v === 'string' && (CARD_DESIGN_IDS as readonly string[]).includes(v);
}

/**
 * The effective card for a section. `sectionDesign` is the section's Card choice: a design id uses that design (keeping
 * the store's out-of-stock look and place, which are store-wide); anything else (`store`, empty, a design that no longer
 * exists) uses the store's card. `design: 'theme'` stays `'theme'`: the card then draws as it does today.
 *
 * The section's switches work one way under a design: rating and badges `false` hide that line (`true` leaves it to the
 * design), tagline and swatches `true` show that line (`false`, the section default, leaves it to the design). Under
 * `theme` a `false` switch turns its line off and `true` changes nothing, as before.
 */
export function resolveCardLook(store: ProductCardSettings, sectionDesign: string | undefined, switches: CardSwitches): ResolvedCardLook {
  const base = isDesignId(sectionDesign)
    ? { ...cloneProductCard(CARD_DESIGNS[sectionDesign]), oos_look: store.oos_look, oos_place: store.oos_place }
    : cloneProductCard(store);
  const hide = new Set<CardLineId>();
  const show = new Set<CardLineId>();
  if (switches.rating === false) hide.add('rating');
  if (base.design === 'theme') {
    if (switches.tagline === false) hide.add('tagline');
    if (switches.swatches === false) hide.add('swatches');
  } else {
    if (switches.tagline === true) show.add('tagline');
    if (switches.swatches === true) show.add('swatches');
  }
  return {
    ...base,
    lines: base.lines.map((l) => (hide.has(l.id) ? { ...l, on: false } : show.has(l.id) ? { ...l, on: true } : l)),
    show_badges: switches.badges !== false,
  };
}

/** Name and price share one row: the switch is on, name is shown, and price is the next shown line after it. */
export function nameAndPriceInRow(look: Pick<ProductCardSettings, 'name_price_row' | 'lines'>): boolean {
  if (!look.name_price_row) return false;
  const shown = look.lines.filter((l) => l.on);
  const i = shown.findIndex((l) => l.id === 'name');
  return i >= 0 && shown[i + 1]?.id === 'price';
}

/** One set of classes for the card root; empty for `theme`, so existing stores keep today's markup. */
export function cardLookClasses(look: ResolvedCardLook): string {
  if (look.design === 'theme') return '';
  const c = [
    `pc-layout-${look.layout}`,
    `pc-shape-${look.image_shape}`,
    `pc-fit-${look.image_fit}`,
    `pc-imghover-${look.image_hover}`,
    `pc-badge-${look.badge_shape}`,
    `pc-badgepos-${look.badge_position}`,
    `pc-badgecol-${look.badge_colors}`,
    `pc-btn-${look.button_style}`,
    `pc-act-${look.button_action}`,
    `pc-after-${look.after_add}`,
    `pc-wish-${look.wishlist}`,
    `pc-wishbg-${look.wishlist_bg}`,
    `pc-align-${look.align}`,
    `pc-shadow-${look.shadow}`,
    `pc-hover-${look.hover}`,
    `pc-namefont-${look.name_font}`,
    `pc-namecase-${look.name_case}`,
    `pc-namelines-${look.name_lines}`,
    `pc-namesize-${look.name_size}`,
    `pc-rating-${look.rating_style}`,
    `pc-pricesize-${look.price_size}`,
    `pc-pricecolor-${look.price_color}`,
    `pc-disc-${look.discount_style}`,
    `pc-oos-${look.oos_look}`,
  ];
  if (look.button_fill !== 'filled') c.push(`pc-btn-${look.button_fill}`);
  if (look.button_shape !== 'rounded') c.push(`pc-btn-${look.button_shape}`);
  if (look.button_reveal !== 'always') c.push(`pc-btn-reveal-${look.button_reveal}`);
  if (look.badge_icon !== 'none') c.push(`pc-icon-${look.badge_icon}`);
  if (look.image_swipe) c.push('pc-swipe');
  if (!look.show_mrp) c.push('pc-nomrp');
  if (look.image_bg) c.push('pc-imgbg');
  if (look.background_image) c.push('pc-bgimg');
  if (look.color_scheme) c.push('pc-scheme');
  if (nameAndPriceInRow(look)) c.push('pc-row-np');
  return c.join(' ');
}

/** `url("...")` for a picture link, with the characters that could end the string or the value made harmless. */
function cssUrl(link: string): string {
  return `url("${link.replace(/["\\\r\n]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)}")`;
}

/** CSS variables for the card root (measurements and pictures); empty for `theme`. Colours come from the colour scheme. */
export function cardLookVars(look: ResolvedCardLook): Record<string, string> {
  if (look.design === 'theme') return {};
  const v: Record<string, string> = {
    '--pc-radius': `${look.radius}px`,
    '--pc-border': `${look.border}px`,
    '--pc-padding': `${look.padding}px`,
    '--pc-img-padding': `${look.image_padding}px`,
    '--pc-img-radius': `${look.image_radius}px`,
  };
  if (look.image_bg) v['--pc-img-bg'] = look.image_bg;
  if (look.background_image) v['--pc-bg-image'] = cssUrl(look.background_image);
  return v;
}
