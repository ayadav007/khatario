/**
 * Server-side text rasterizer for /api/print/render (the Flutter phone app gets ready printer bytes).
 * sharp's text input uses Pango + HarfBuzz, so Hindi, Gujarati, Tamil… are shaped properly, using the
 * server's installed fonts (the same ones the PDF bills use; install fonts-noto on the VPS).
 *
 * The print builders call their rasterizer synchronously, so rendering is two passes:
 *   1. build with a recording rasterizer (placeholder images) to learn which texts are needed;
 *   2. draw them all with sharp, then build again with the real images.
 * Layout does not depend on the images, so both passes make the same calls.
 */

import { blankBitmap, blit, packRgba, type MonoBitmap, type RasterTextOptions, type TextRasterizer } from './bitmap';

const FONT_FAMILIES = 'Noto Sans, Noto Sans Devanagari, Noto Sans Gujarati, Noto Sans Tamil, Noto Sans Bengali, Nirmala UI, sans';

function keyOf(text: string, o: RasterTextOptions): string {
  return `${o.heightDots}|${o.bold ? 1 : 0}|${o.maxWidthDots}|${text}`;
}

function pangoEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function drawText(text: string, o: RasterTextOptions): Promise<MonoBitmap> {
  const sharp = (await import('sharp')).default;
  const fontPx = Math.max(8, Math.round(o.heightDots * 0.72));
  const { data, info } = await sharp({
    text: {
      text: o.bold ? `<b>${pangoEscape(text)}</b>` : pangoEscape(text),
      font: `${FONT_FAMILIES} ${fontPx}`,
      dpi: 72,
      rgba: true,
    },
  })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // sharp draws white text on transparent: alpha is the ink. Turn it into dark-on-white RGBA.
  const rgba = new Uint8Array(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const ink = data[i * 4 + 3];
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255 - ink;
    rgba[i * 4 + 3] = 255;
  }
  const glyphs = packRgba(rgba, info.width, info.height);
  // Fit into a line of exactly heightDots, vertically centred, cut at maxWidthDots.
  const line = blankBitmap(Math.min(o.maxWidthDots, glyphs.width + 2), o.heightDots);
  blit(line, glyphs, 1, Math.floor((o.heightDots - info.height) / 2));
  return line;
}

/** Runs `build` with a rasterizer backed by sharp (see the file comment for why it builds twice). */
export async function withServerTextRaster<T>(build: (rasterize: TextRasterizer) => T): Promise<T> {
  const needed = new Map<string, { text: string; options: RasterTextOptions }>();
  build((text, options) => {
    needed.set(keyOf(text, options), { text, options });
    return blankBitmap(Math.min(options.maxWidthDots, [...text].length * 8), options.heightDots);
  });

  const drawn = new Map<string, MonoBitmap>();
  await Promise.all(
    [...needed].map(async ([key, { text, options }]) => {
      try {
        drawn.set(key, await drawText(text, options));
      } catch {
        drawn.set(key, blankBitmap(8, options.heightDots));
      }
    })
  );
  return build((text, options) => drawn.get(keyOf(text, options)) ?? blankBitmap(8, options.heightDots));
}
