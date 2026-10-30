// Pure helpers behind the product page components (gestures, zoom, variant selection).
import {
  nextSelection,
  resolveVariant,
  variantOptions,
  type StoreVariantInput,
} from '@/lib/store/variant-options';

export const SWIPE_THRESHOLD = 40;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30;

/** 1 = next slide, -1 = previous, 0 = not a horizontal swipe (vertical scrolls are ignored). */
export function swipeDirection(dx: number, dy: number, threshold = SWIPE_THRESHOLD): -1 | 0 | 1 {
  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/** Index after moving by `step`, wrapping around; 0 when there is nothing to show. */
export function stepIndex(index: number, step: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + step) % count) + count) % count;
}

export type Tap = { t: number; x: number; y: number };

export function isDoubleTap(prev: Tap | null, next: Tap): boolean {
  if (!prev) return false;
  return (
    next.t - prev.t <= DOUBLE_TAP_MS &&
    Math.abs(next.x - prev.x) <= DOUBLE_TAP_SLOP &&
    Math.abs(next.y - prev.y) <= DOUBLE_TAP_SLOP
  );
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/** Keeps a zoomed image covering its box: offset limited to half the overflow on each side. */
export function clampPan(offset: number, scale: number, size: number): number {
  const max = Math.max(0, ((scale - 1) * size) / 2);
  return Math.min(max, Math.max(-max, offset));
}

/** Offset that keeps the point under (px, py), relative to the box centre, still while zooming. */
export function zoomAt(
  point: { x: number; y: number },
  from: { scale: number; x: number; y: number },
  scale: number,
): { x: number; y: number } {
  const k = scale / from.scale;
  return { x: point.x - (point.x - from.x) * k, y: point.y - (point.y - from.y) * k };
}

function normKey(raw: string): string {
  const k = raw.trim().toLowerCase();
  return k === 'color' ? 'colour' : k;
}

/** Axis values of one variant, in the shape `nextSelection` / `resolveVariant` take. */
export function selectionFromVariant(
  variants: StoreVariantInput[],
  id: string | null,
): Record<string, string> {
  const index = id == null ? -1 : variants.findIndex((v) => v.id === id);
  if (index < 0) return {};
  const axes = variantOptions(variants);
  // No attributes: one "Option" axis whose values are unique labels in variant order.
  if (axes.length === 1 && axes[0].values.length === variants.length) {
    return { [axes[0].key]: axes[0].values[index].value };
  }
  const attrs = variants[index].attributes ?? {};
  const out: Record<string, string> = {};
  for (const axis of axes) {
    for (const [k, raw] of Object.entries(attrs)) {
      const val = raw == null ? '' : String(raw).trim();
      if (normKey(String(k)) === axis.key && val) {
        out[axis.key] = val;
        break;
      }
    }
  }
  return out;
}

/** Variant to preselect: the only one, else the first in stock, else the first. */
export function initialVariantId(variants: StoreVariantInput[]): string | null {
  if (variants.length === 0) return null;
  const inStock = variants.find((v) => Number(v.current_stock ?? 0) > 0);
  return (inStock ?? variants[0]).id;
}

/** Identity of a variant list, so a new product's variants can be told apart from a re-render. */
export function variantsKey(variants: StoreVariantInput[]): string {
  return variants.map((v) => v.id).join('|');
}

/**
 * Preselect once per variant list: `emit` is the id to send (or null), `doneKey` the list now
 * handled. A list that already has a value counts as handled, so clearing it later is respected.
 */
export function preselect(
  doneKey: string | null,
  variants: StoreVariantInput[],
  value: string | null,
): { doneKey: string | null; emit: string | null } {
  const key = variantsKey(variants);
  if (doneKey === key) return { doneKey, emit: null };
  if (value != null) return { doneKey: key, emit: null };
  const id = initialVariantId(variants);
  return id ? { doneKey: key, emit: id } : { doneKey, emit: null };
}

/**
 * Shared body scroll lock: the first holder saves and locks, the last one out restores, so
 * nested overlays closing in the same commit (modal + lightbox) never leave the page locked.
 */
export function createScrollLock(get: () => string, set: (overflow: string) => void) {
  let count = 0;
  let saved = '';
  return {
    lock() {
      if (count++ === 0) {
        saved = get();
        set('hidden');
      }
    },
    unlock() {
      if (count === 0) return;
      if (--count === 0) set(saved);
    },
    get count() {
      return count;
    },
  };
}

/** Variant id after the shopper picks `value` on axis `key`, or null when nothing matches. */
export function pickVariant(
  variants: StoreVariantInput[],
  currentId: string | null,
  key: string,
  value: string,
): string | null {
  const next = nextSelection(variants, selectionFromVariant(variants, currentId), key, value);
  return resolveVariant(variants, next)?.id ?? null;
}

/** Whether `value` on `key` is in stock alongside the shopper's other choices. */
export function valueInStock(
  variants: StoreVariantInput[],
  selection: Record<string, string>,
  key: string,
  value: string,
): boolean {
  const match = resolveVariant(variants, { ...selection, [key]: value });
  if (match) return match.current_stock > 0;
  return variantOptions(variants)
    .find((a) => a.key === key)
    ?.values.some((v) => v.value === value && v.inStock) ?? false;
}
