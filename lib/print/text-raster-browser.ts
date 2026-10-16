/**
 * Canvas text rasterizer for the browser, the Android app's WebView and the Windows app.
 * Draws Hindi, Gujarati, Tamil, Urdu… and ₹ with the device's own fonts (Nirmala UI on Windows,
 * Noto on Android), so thermal printers without Indic font chips still print them.
 */

import { packRgba, type MonoBitmap, type RasterTextOptions, type TextRasterizer } from '@/lib/print/bitmap';

const FONT_STACK =
  '"Nirmala UI", "Noto Sans", "Noto Sans Devanagari", "Noto Sans Gujarati", "Noto Sans Tamil", "Noto Sans Telugu", "Noto Sans Kannada", "Noto Sans Malayalam", "Noto Sans Bengali", "Noto Sans Gurmukhi", "Noto Sans Oriya", "Noto Nastaliq Urdu", "Mangal", Arial, sans-serif';

type Canvas2D = {
  font: string;
  textBaseline: string;
  fillStyle: string;
  measureText(text: string): { width: number };
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> };
};

function makeContext(width: number, height: number): Canvas2D | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    return canvas.getContext('2d') as unknown as Canvas2D | null;
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas.getContext('2d') as unknown as Canvas2D | null;
  }
  return null;
}

function fit(ctx: Canvas2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

export const rasterizeTextInBrowser: TextRasterizer = (text: string, options: RasterTextOptions): MonoBitmap => {
  const height = Math.max(8, Math.round(options.heightDots));
  // Glyphs with matras above/below need room: the font is ~78% of the line.
  const fontPx = Math.max(6, Math.round(height * 0.78));
  const font = `${options.bold ? '700' : '400'} ${fontPx}px ${FONT_STACK}`;

  const probe = makeContext(1, 1);
  if (!probe) throw new Error('Text cannot be drawn on this device');
  probe.font = font;
  const shown = fit(probe, text, options.maxWidthDots);
  const width = Math.max(8, Math.min(options.maxWidthDots, Math.ceil(probe.measureText(shown).width) + 2));

  const ctx = makeContext(width, height);
  if (!ctx) throw new Error('Text cannot be drawn on this device');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(shown, 1, height / 2);
  return packRgba(ctx.getImageData(0, 0, width, height).data, width, height);
};

/** The rasterizer for this runtime, or undefined on the server (callers then fall back to ASCII). */
export function browserTextRasterizer(): TextRasterizer | undefined {
  if (typeof window === 'undefined') return undefined;
  return rasterizeTextInBrowser;
}
