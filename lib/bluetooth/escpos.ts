/**
 * ESC/POS ENCODER
 *
 * Small, dependency-free builder that assembles a byte stream of ESC/POS
 * commands suitable for almost any 58mm/80mm thermal receipt printer.
 *
 * Coverage
 * --------
 *   - Text + CP437 / ASCII encoding
 *   - Alignment (left / center / right)
 *   - Size (normal / double-height / double-width)
 *   - Bold, underline
 *   - Line feed + paper cut
 *   - Built-in 1D barcodes (UPC-A, EAN-13, CODE128, CODE39)
 *   - Built-in QR code (GS ( k model 2)
 *   - Raster image (GS v 0) for arbitrary graphics like Data Matrix or
 *     bitmap barcodes rendered from bwip-js
 *   - Beep + kick cash drawer (best-effort; not all BT printers support)
 *
 * Limits worth knowing
 * --------------------
 *   - Chinese / Indic text is NOT supported here. Receipt printers need a
 *     font chip for non-CP437 text. For international strings, use
 *     encodeRaster() with an off-screen canvas draw. Indian customer names
 *     in English/Hinglish work fine.
 *   - Image width is rounded down to a multiple of 8 pixels (ESC/POS
 *     constraint). Feed the exact printer width (384 dots for 58mm @ 203dpi,
 *     576 for 80mm) to avoid scaling.
 *   - `cut()` issues a partial cut. Printers without a cutter ignore it.
 *
 * References
 * ----------
 *   * Epson ESC/POS FS command reference (v1.0, 2016)
 *   * Rongta RPP_Programming_Manual.pdf
 *   * https://reference.epson-biz.com/modules/ref_escpos/
 */

// ---------------------------------------------------------------------------
// Byte-level constants
// ---------------------------------------------------------------------------

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const NUL = 0x00;

/** Paper widths in printer dots at 203 dpi. */
export const DOTS_PER_LINE: Record<58 | 80, number> = {
  58: 384,
  80: 576,
};

/** Character columns for Font A (12x24) at the two common paper widths. */
export const COLS_FONT_A: Record<58 | 80, number> = {
  58: 32,
  80: 48,
};

export type Align = 'left' | 'center' | 'right';
export type BarcodeKind = 'UPCA' | 'EAN13' | 'CODE39' | 'CODE128';
export type QrSize = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type QrEcLevel = 'L' | 'M' | 'Q' | 'H';

export interface EscPosBuilderOptions {
  /** Paper width in mm. Controls text wrapping and column math. */
  paperWidthMm: 58 | 80;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Mutable ESC/POS byte buffer with a fluent API. Call `build()` to get the
 * final Uint8Array that can be handed to the Bluetooth driver.
 */
export class EscPosBuilder {
  private chunks: number[] = [];
  readonly paperWidthMm: 58 | 80;
  readonly dotsPerLine: number;
  readonly colsFontA: number;

  constructor(opts: EscPosBuilderOptions = { paperWidthMm: 58 }) {
    this.paperWidthMm = opts.paperWidthMm;
    this.dotsPerLine = DOTS_PER_LINE[opts.paperWidthMm];
    this.colsFontA = COLS_FONT_A[opts.paperWidthMm];
  }

  // -------------------------------------------------------------------------
  // Low-level helpers
  // -------------------------------------------------------------------------

  /** Append raw bytes. */
  raw(bytes: number[] | Uint8Array): this {
    for (const b of bytes) this.chunks.push(b & 0xff);
    return this;
  }

  private asciiBytes(text: string): number[] {
    // ESC/POS receipt printers default to CP437. We translate common
    // non-ASCII characters to their nearest ASCII equivalents; everything
    // else is mapped to '?' so the printer doesn't swallow the line.
    const out: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (ch === 0x20a8 || ch === 0x20b9) {
        // ₨ (Rs) or ₹ (INR) → "Rs" (printers don't have these glyphs).
        out.push(0x52, 0x73);
      } else if (ch < 0x7f) {
        out.push(ch);
      } else {
        out.push(0x3f);
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Initialization / line feeds / cuts
  // -------------------------------------------------------------------------

  /** ESC @ — reset printer to factory defaults (alignment, size, bold off). */
  init(): this {
    return this.raw([ESC, 0x40]);
  }

  /** Feed n lines of paper (default 1). */
  feed(n = 1): this {
    for (let i = 0; i < Math.max(1, Math.floor(n)); i++) this.chunks.push(LF);
    return this;
  }

  /** GS V — partial cut. No-op on printers without a cutter. */
  cut(): this {
    // feed a bit first so the text isn't clipped
    this.feed(3);
    return this.raw([GS, 0x56, 0x42, 0x00]);
  }

  /** ESC B — beep (only supported on some printers). */
  beep(times = 1, durationTenths = 2): this {
    return this.raw([ESC, 0x42, Math.min(9, times), Math.min(9, durationTenths)]);
  }

  // -------------------------------------------------------------------------
  // Text formatting
  // -------------------------------------------------------------------------

  /** ESC a n — alignment (0 left, 1 center, 2 right). */
  align(align: Align): this {
    const n = align === 'center' ? 1 : align === 'right' ? 2 : 0;
    return this.raw([ESC, 0x61, n]);
  }

  /** ESC E n — bold on/off. */
  bold(on = true): this {
    return this.raw([ESC, 0x45, on ? 1 : 0]);
  }

  /** ESC - n — underline (0 off, 1 one-dot, 2 two-dot). */
  underline(mode: 0 | 1 | 2 = 1): this {
    return this.raw([ESC, 0x2d, mode]);
  }

  /**
   * GS ! n — text size. `width` and `height` are 1..8 magnifications where
   * 1 is normal, 2 is double, etc.
   */
  size(width: 1 | 2 | 3 | 4 = 1, height: 1 | 2 | 3 | 4 = 1): this {
    const n = ((width - 1) << 4) | (height - 1);
    return this.raw([GS, 0x21, n]);
  }

  /** Convenience: reset size to 1x1. */
  sizeNormal(): this {
    return this.size(1, 1);
  }

  /** Convenience: double-height + single-width (good for product names). */
  sizeTall(): this {
    return this.size(1, 2);
  }

  /** Convenience: double-width + double-height (headers). */
  sizeBig(): this {
    return this.size(2, 2);
  }

  // -------------------------------------------------------------------------
  // Text output
  // -------------------------------------------------------------------------

  /** Write a string without a trailing newline. Non-ASCII chars become '?'. */
  text(text: string): this {
    return this.raw(this.asciiBytes(text));
  }

  /** Write a string followed by a newline. */
  line(text = ''): this {
    this.text(text);
    this.chunks.push(LF);
    return this;
  }

  /**
   * Print `left` flush left and `right` flush right on the same line,
   * padded out to `cols` (default is the paper's Font-A column count).
   */
  twoColumn(left: string, right: string, cols = this.colsFontA): this {
    const l = left.slice(0, cols - 1);
    const r = right.slice(0, cols - 1);
    const padding = Math.max(1, cols - l.length - r.length);
    return this.line(l + ' '.repeat(padding) + r);
  }

  /** Print a full-width separator line of `ch` characters. */
  separator(ch = '-'): this {
    return this.line(ch.repeat(this.colsFontA));
  }

  // -------------------------------------------------------------------------
  // Built-in barcodes
  // -------------------------------------------------------------------------

  /**
   * Print an ESC/POS native 1D barcode. For cases where the printer's
   * built-in resolver doesn't accept our input (e.g. non-digit strings under
   * EAN-13), fall back to encodeRaster() with bwip-js.
   */
  barcode(kind: BarcodeKind, data: string, opts: {
    /** Bar height in dots (1..255). Default 80. */
    height?: number;
    /** Bar module width (2..6 on most printers). Default 2. */
    width?: 2 | 3 | 4 | 5 | 6;
    /** Where to print the human-readable text. */
    hri?: 'none' | 'above' | 'below' | 'both';
  } = {}): this {
    const height = Math.max(1, Math.min(255, opts.height ?? 80));
    const width = opts.width ?? 2;
    const hri = opts.hri ?? 'below';

    // GS h n — barcode height
    this.raw([GS, 0x68, height]);
    // GS w n — barcode width multiplier
    this.raw([GS, 0x77, width]);
    // GS H n — HRI position
    const hriByte = hri === 'none' ? 0 : hri === 'above' ? 1 : hri === 'below' ? 2 : 3;
    this.raw([GS, 0x48, hriByte]);
    // GS f n — HRI font (0 = Font A)
    this.raw([GS, 0x66, 0x00]);

    // GS k m d1..dk NUL (function-B style using length prefix)
    const typeMap: Record<BarcodeKind, number> = {
      UPCA: 0x41,
      EAN13: 0x43,
      CODE39: 0x45,
      CODE128: 0x49,
    };
    const m = typeMap[kind];
    const payload: number[] = [];
    if (kind === 'CODE128') {
      // CODE128 requires a leading code-set selector. We default to "{B" for
      // full ASCII — matches most POS setups.
      payload.push(0x7b, 0x42);
    }
    for (let i = 0; i < data.length; i++) payload.push(data.charCodeAt(i) & 0xff);

    // Use function B (length prefix) so arbitrary control codes in CODE128 work.
    this.raw([GS, 0x6b, m, payload.length]);
    this.raw(payload);
    return this;
  }

  /**
   * Print a QR code using GS ( k (Model 2). Supported by all modern ESC/POS
   * printers; some very old clones only accept raster images, in which case
   * fall back to encodeRaster().
   */
  qrcode(data: string, opts: { size?: QrSize; ecLevel?: QrEcLevel } = {}): this {
    const size = opts.size ?? 6;
    const ec = opts.ecLevel ?? 'M';
    const ecMap: Record<QrEcLevel, number> = { L: 48, M: 49, Q: 50, H: 51 };

    // Set model 2
    this.raw([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
    // Set module size
    this.raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]);
    // Set EC level
    this.raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, ecMap[ec]]);

    // Store data
    const bytes = this.asciiBytes(data);
    const total = bytes.length + 3;
    const pL = total & 0xff;
    const pH = (total >> 8) & 0xff;
    this.raw([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]);
    this.raw(bytes);

    // Print
    this.raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
    return this;
  }

  // -------------------------------------------------------------------------
  // Raster image
  // -------------------------------------------------------------------------

  /**
   * Emit a GS v 0 raster image from a monochrome bitmap. Use this for
   * rendering bwip-js barcode output or any pre-rasterized graphic.
   *
   * `pixels` is an array of length `width * height` where each element is
   *   0 = white
   *   1 = black
   * The width is automatically rounded up to a multiple of 8 with padding
   * on the right because ESC/POS packs 8 pixels per byte.
   */
  raster(pixels: ArrayLike<number>, width: number, height: number): this {
    const paddedWidth = Math.ceil(width / 8) * 8;
    const bytesPerRow = paddedWidth / 8;
    const buf = new Uint8Array(bytesPerRow * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[y * width + x]) {
          const byteIdx = y * bytesPerRow + (x >> 3);
          buf[byteIdx] |= 0x80 >> (x & 7);
        }
      }
    }

    // GS v 0 m xL xH yL yH  d1..dk
    // m=0 -> normal (non-scaled) mode
    const xL = bytesPerRow & 0xff;
    const xH = (bytesPerRow >> 8) & 0xff;
    const yL = height & 0xff;
    const yH = (height >> 8) & 0xff;
    this.raw([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
    this.raw(buf);
    return this;
  }

  // -------------------------------------------------------------------------
  // Finalize
  // -------------------------------------------------------------------------

  build(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

// ---------------------------------------------------------------------------
// Standalone convenience helpers
// ---------------------------------------------------------------------------

/**
 * Convert an RGBA ImageData-like object to a 1-bit array suitable for
 * EscPosBuilder.raster(). Uses a simple luminance threshold; good enough for
 * barcodes and line art, not for photos.
 */
export function rgbaToBits(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold = 160
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    const lum = (r * 299 + g * 587 + b * 114) / 1000;
    out[p] = a > 10 && lum < threshold ? 1 : 0;
  }
  return out;
}

/**
 * Concatenate multiple Uint8Arrays end-to-end. Handy when stitching together
 * multiple builder outputs (e.g. one per label).
 */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
