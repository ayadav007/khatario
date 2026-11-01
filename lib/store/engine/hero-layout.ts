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
 * movement and phone alignment. Without any picture there is nothing to fit, move or put words under.
 */
export function heroRootClasses(o: {
  height: string;
  motion: string;
  box: boolean;
  textColor: boolean;
  textBelowMobile: boolean;
  twoImagesMobile: string;
  alignMobile: string;
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
