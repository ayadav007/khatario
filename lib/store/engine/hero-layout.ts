// Client-safe: pure helpers for the Hero banner (image-banner), no server imports.
import { isVideoUrl } from '@/lib/store/theme-media-url';

export type HeroSlot = 'main' | 'second' | 'phone';
export interface HeroLayer {
  url: string;
  video: boolean;
  slot: HeroSlot;
}

const ROWS = ['top', 'middle', 'bottom'];
const COLS = ['left', 'center', 'right'];
const ALIGNS = ['left', 'center', 'right'];
const HEIGHTS = ['adapt', 'small', 'medium', 'large'];
const MOTION_CLASS: Record<string, string> = { drift: 'drift', zoom_scroll: 'zoom', fixed: 'fixed' };
/** How much `zoom_scroll` enlarges the picture by the time the hero has scrolled out at the top. */
const ZOOM = 0.15;

const alignOf = (a: string): string => (ALIGNS.includes(a) ? a : 'left');

/** Where the words sit (one of nine cells) and how their lines align: `hb-pos-<row>-<col> hb-align-<a>`. */
export function heroGridClass(position: string, align: string): string {
  const [row, col, extra] = position.split('-');
  const pos = extra === undefined && ROWS.includes(row) && COLS.includes(col) ? position : 'middle-left';
  return `hb-pos-${pos} hb-align-${alignOf(align)}`;
}

/** The hero's pictures in order (first, second, phone), each marked as video or picture; empty ones are left out. */
export function heroImageLayers(o: { image: string; image2: string; mobileImage: string }): HeroLayer[] {
  const out: HeroLayer[] = [];
  const add = (url: string, slot: HeroSlot) => {
    if (url.trim()) out.push({ url, video: isVideoUrl(url), slot });
  };
  add(o.image, 'main');
  add(o.image2, 'second');
  add(o.mobileImage, 'phone');
  return out;
}

/**
 * The hero's state classes (hero.css): height, box, text colour, white words over a picture (desktop `hb-white`,
 * phones `hb-white-m`), two pictures and their phone layout, the phone picture, words under the picture on phones,
 * movement and phone alignment. Without any picture there is nothing to fit, move or put words under. A picture with no
 * words (`hb-bare`) gets a height of its own, since nothing else holds the card open (not with `adapt`, where the
 * picture sets it); with only a phone picture it shows on phones only (`hb-phone-only`).
 */
/**
 * The owner's own heights (px) as CSS variables and classes; 0 or less keeps the Height choice, so a value is only
 * set for a size the owner picked. Computers and phones are separate (hero.css applies each in its own width range).
 */
export function heroHeightStyle(desktop: number, mobile: number): { classes: string; vars: Record<string, string> } {
  const classes: string[] = [];
  const vars: Record<string, string> = {};
  if (Number.isFinite(desktop) && desktop > 0) {
    classes.push('hb-hpx');
    vars['--hb-h'] = `${Math.round(desktop)}px`;
  }
  if (Number.isFinite(mobile) && mobile > 0) {
    classes.push('hb-hpx-m');
    vars['--hb-h-m'] = `${Math.round(mobile)}px`;
  }
  return { classes: classes.join(' '), vars };
}

export function heroRootClasses(o: {
  height: string;
  motion: string;
  box: boolean;
  textColor: boolean;
  textBelowMobile: boolean;
  twoImagesMobile: string;
  alignMobile: string;
  /** The hero has content blocks to show. */
  words: boolean;
  layers: HeroLayer[];
}): string {
  const has = (slot: HeroSlot) => o.layers.some((l) => l.slot === slot);
  const desk = has('main') || has('second');
  const phonePic = has('phone');
  const onPhone = desk || phonePic;
  const height = HEIGHTS.includes(o.height) && (o.height !== 'adapt' || onPhone) ? o.height : 'medium';
  const below = o.textBelowMobile && onPhone;
  const plain = !o.box && !o.textColor;
  const two = has('main') && has('second');
  const motion = onPhone ? MOTION_CLASS[o.motion] : undefined;
  const bare = !o.words && onPhone;
  return [
    `hb-h-${height}`,
    o.box ? 'hb-box' : '',
    o.textColor ? 'hb-text' : '',
    plain && desk ? 'hb-white' : '',
    plain && onPhone && !below ? 'hb-white-m' : '',
    two ? 'hb-two' : '',
    two && o.twoImagesMobile === 'first' ? 'hb-m-first' : '',
    phonePic ? 'hb-has-phone' : '',
    below ? 'hb-below-m' : '',
    motion ? `hb-motion-${motion}` : '',
    bare && height !== 'adapt' ? 'hb-bare' : '',
    bare && !desk ? 'hb-phone-only' : '',
    `hb-malign-${alignOf(o.alignMobile)}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * `zoom_scroll`: the picture's scale for the hero's top edge and height and the window height, growing from 1 as the
 * hero enters at the bottom to 1.15 as it leaves at the top.
 */
export function heroZoomScale(top: number, height: number, viewport: number): number {
  const span = viewport + height;
  if (!(span > 0) || !Number.isFinite(top)) return 1;
  const progress = Math.min(1, Math.max(0, (viewport - top) / span));
  return Math.round((1 + ZOOM * progress) * 10000) / 10000;
}
