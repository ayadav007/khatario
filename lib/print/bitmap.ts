/**
 * 1-bit images for thermal printers: rows packed 8 pixels per byte, most significant bit first,
 * 1 = black. ESC/POS (GS v 0) and ZPL (^GF) use this as-is; TSPL BITMAP wants it inverted.
 */

export type MonoBitmap = {
  /** Width in pixels (always a multiple of 8). */
  width: number;
  height: number;
  /** height × (width / 8) bytes. */
  data: Uint8Array;
};

export function bytesPerRow(bitmap: MonoBitmap): number {
  return bitmap.width / 8;
}

/**
 * Pack RGBA pixels (e.g. canvas ImageData) into a MonoBitmap. A pixel is black when it is dark
 * enough and not transparent. Width is padded up to a multiple of 8 with white.
 */
export function packRgba(rgba: ArrayLike<number>, width: number, height: number, threshold = 160): MonoBitmap {
  const paddedWidth = Math.ceil(width / 8) * 8;
  const rowBytes = paddedWidth / 8;
  const data = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = rgba[i + 3];
      const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      // Transparent counts as white; otherwise blend luminance against white by alpha.
      const shade = 255 - ((255 - lum) * alpha) / 255;
      if (shade < threshold) data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width: paddedWidth, height, data };
}

/** TSPL BITMAP treats 0 as black, so its data is the inverse of ours. */
export function invertBits(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = ~data[i] & 0xff;
  return out;
}

/** Uppercase hex of the bitmap rows, as ZPL ^GFA expects. */
export function toHex(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i++) s += data[i].toString(16).padStart(2, '0');
  return s.toUpperCase();
}

/** Text the printer's built-in fonts cannot show: anything outside printable ASCII (Hindi, ₹, é…). */
export function needsRaster(text: string): boolean {
  return /[^\x20-\x7e]/.test(text);
}

export type RasterTextOptions = {
  /** Line height in printer dots. */
  heightDots: number;
  bold?: boolean;
  /** Longest the image may be; longer text is cut with an ellipsis. */
  maxWidthDots: number;
};

/** Draws one line of text as a MonoBitmap. Browsers / WebViews provide one via canvas. */
export type TextRasterizer = (text: string, options: RasterTextOptions) => MonoBitmap;

/** A white bitmap; width is rounded up to a multiple of 8. */
export function blankBitmap(width: number, height: number): MonoBitmap {
  const w = Math.ceil(Math.max(8, width) / 8) * 8;
  return { width: w, height, data: new Uint8Array((w / 8) * height) };
}

/** Copies the black pixels of `src` onto `dst` at (x, y), clipping at the edges. */
export function blit(dst: MonoBitmap, src: MonoBitmap, x: number, y: number): void {
  const dstRow = dst.width / 8;
  const srcRow = src.width / 8;
  for (let sy = 0; sy < src.height; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= dst.height) continue;
    for (let sx = 0; sx < src.width; sx++) {
      if (!(src.data[sy * srcRow + (sx >> 3)] & (0x80 >> (sx & 7)))) continue;
      const dx = x + sx;
      if (dx < 0 || dx >= dst.width) continue;
      dst.data[dy * dstRow + (dx >> 3)] |= 0x80 >> (dx & 7);
    }
  }
}
