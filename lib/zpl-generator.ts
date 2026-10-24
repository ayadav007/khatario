/**
 * ZPL GENERATOR
 *
 * Converts a {@link LabelTemplate} + {@link LabelLine}s into Zebra Programming
 * Language (ZPL II) — the native format for Zebra, TSC, Godex, Honeywell and
 * most thermal barcode printers that sit on retail/warehouse floors.
 *
 * Why this exists:
 *   - PDF output is great for A4 laser sheets, but operators printing hundreds
 *     of labels/day on a thermal printer want to stream raw ZPL to the device
 *     (USB / CUPS / TCP 9100). ZPL renders faster, yields sharper barcodes,
 *     and lets printer-side darkness/speed settings take effect.
 *
 * Scope:
 *   - ROLL templates are first-class. Each line * copies produces one label.
 *   - A4_SHEET templates fall back to printing each cell as a single ROLL
 *     label (most thermal operators will not print A4 layouts anyway).
 *   - Absolute-positioned fields (x_mm, y_mm, w_mm, h_mm from the Phase-3
 *     designer) are honoured. Legacy stacked templates render with a simple
 *     top-to-bottom flow.
 *
 * Units:
 *   - Thermal printers work in dots, not mm. Default resolution is 203 dpi
 *     (8 dots/mm) which is by far the most common. Callers can override
 *     via `dpi` — 300 dpi is the other common value (~11.81 dots/mm).
 */

import type { LabelTemplate, LabelLine, LabelFieldConfig } from './label-document-builder';
import type { LabelSymbology } from './barcode-renderer';
import { layoutLabel, withAffixes } from '@/lib/print/label-layout';
import { bytesPerRow, needsRaster, toHex, type TextRasterizer } from '@/lib/print/bitmap';

// ============================================================================
// PUBLIC API
// ============================================================================

export interface BuildZplArgs {
  template: LabelTemplate;
  lines: LabelLine[];
  businessName: string;
  /** Printer head resolution (dots/inch). Default 203. */
  dpi?: 203 | 300 | 600;
  /** Draws Hindi / Gujarati / ₹… as ^GF images (printers have no Indic fonts). Browser only. */
  rasterize?: TextRasterizer;
}

/**
 * Build the ZPL stream for an entire print job.
 *
 * Returns a single string that can be written directly to a thermal printer
 * (e.g. POSTed with Content-Type `application/zpl` to a print server, piped
 * to `lp -d ZEBRA -o raw`, or sent over a TCP socket on port 9100).
 */
export function buildLabelDocumentZpl(args: BuildZplArgs): string {
  const { template, lines, businessName } = args;
  const dpi = args.dpi ?? 203;
  const dotsPerMm = dpi / 25.4;

  const chunks: string[] = [];

  // Job header: ^CI28 switches to UTF-8 so the rupee sign and accented characters print.
  chunks.push('^XA^CI28^XZ');

  for (const line of lines) {
    const copies = Math.max(1, Math.floor(line.copies || 1));
    const labelZpl = renderSingleLabelZpl(template, line, businessName, dotsPerMm, args.rasterize);
    for (let i = 0; i < copies; i++) {
      chunks.push(labelZpl);
    }
  }

  return chunks.join('\n');
}

// ============================================================================
// INTERNAL - SINGLE LABEL (layout shared with TSPL: lib/print/label-layout.ts)
// ============================================================================

function renderSingleLabelZpl(
  template: LabelTemplate,
  line: LabelLine,
  businessName: string,
  dotsPerMm: number,
  rasterize?: TextRasterizer
): string {
  const header = [
    '^XA',
    `^PW${mm2dots(template.widthMm, dotsPerMm)}`,
    `^LL${mm2dots(template.heightMm, dotsPerMm)}`,
    '^LH0,0',
  ].join('');

  const body = layoutLabel(template, line, businessName)
    .map((el) => {
      const x = mm2dots(el.xMm, dotsPerMm);
      const y = mm2dots(el.yMm, dotsPerMm);
      const w = mm2dots(el.wMm, dotsPerMm);
      const h = mm2dots(el.hMm, dotsPerMm);
      if (el.kind === 'barcode') return barcodeCommand(el.value, el.symbology, x, y, w, h);
      const shown = withAffixes(el.text, el.field);
      if (rasterize && needsRaster(shown)) return imageTextCommand(shown, x, y, w, h, el.field, rasterize);
      return textCommand(el.text, x, y, w, h, el.field);
    })
    .join('');

  return `${header}${body}^XZ`;
}

/**
 * Emit a ^FO ... ^FB ... ^FD ... ^FS block for wrapped text.
 *
 * `^FB` (Field Block) handles word wrap inside the width; align maps to the
 * first argument (L/C/R) of ^FB.
 */
function textCommand(
  text: string,
  xDots: number,
  yDots: number,
  wDots: number,
  hDots: number,
  field: Partial<LabelFieldConfig>
): string {
  const pt = field.fontSize ?? 8;
  // ZPL ^A0 takes (height,width) in dots. 1pt ≈ 2.82 dots at 203dpi.
  // Use ~3 dots per pt as a readable default.
  const charHeightDots = Math.max(10, Math.round(pt * 3));
  const charWidthDots = Math.max(6, Math.round(charHeightDots * 0.55));

  const align =
    field.align === 'center' ? 'C' : field.align === 'right' ? 'R' : 'L';

  // How many lines fit in the box.
  const maxLines = Math.max(1, Math.floor(hDots / (charHeightDots + 2)));

  const prefixed =
    (field.prefix || '') + String(text) + (field.suffix || '');
  const sanitized = zplEscape(prefixed);

  // ^FO x,y → origin. ^A0N,h,w → scalable font 0. ^FB w,maxLines,space,align
  return `^FO${xDots},${yDots}^A0N,${charHeightDots},${charWidthDots}^FB${wDots},${maxLines},0,${align},0^FD${sanitized}^FS`;
}

/** Text drawn as a ^GFA image, for scripts the printer has no font for. */
function imageTextCommand(
  text: string,
  xDots: number,
  yDots: number,
  wDots: number,
  hDots: number,
  field: Partial<LabelFieldConfig>,
  rasterize: TextRasterizer
): string {
  const pt = field.fontSize ?? 8;
  const lineDots = Math.min(hDots, Math.max(14, Math.round(pt * 3 * 1.3)));
  const img = rasterize(text, { heightDots: lineDots, bold: field.bold, maxWidthDots: wDots });
  const used = Math.min(img.width, wDots);
  const x =
    field.align === 'center' ? xDots + Math.floor((wDots - used) / 2) : field.align === 'right' ? xDots + wDots - used : xDots;
  const total = img.data.length;
  return `^FO${x},${yDots}^GFA,${total},${total},${bytesPerRow(img)},${toHex(img.data)}^FS`;
}

/**
 * Emit a barcode command for the given symbology. Supports the common retail
 * ones; falls back to CODE128 for anything we don't handle explicitly.
 */
function barcodeCommand(
  value: string,
  symbology: LabelSymbology,
  xDots: number,
  yDots: number,
  wDots: number,
  hDots: number
): string {
  // ^BY sets default bar width (module width) and wide:narrow ratio.
  // width=2 dots is a solid default at 203dpi.
  const by = `^BY2,3,${hDots}`;

  const origin = `^FO${xDots},${yDots}`;

  switch (symbology) {
    case 'EAN13': {
      const clean = value.replace(/\D/g, '').padStart(13, '0').slice(0, 13);
      return `${origin}${by}^BEN,${hDots},Y,N^FD${clean}^FS`;
    }
    case 'EAN8': {
      const clean = value.replace(/\D/g, '').padStart(8, '0').slice(0, 8);
      return `${origin}${by}^B8N,${hDots},Y,N^FD${clean}^FS`;
    }
    case 'UPC': {
      const clean = value.replace(/\D/g, '').padStart(12, '0').slice(0, 12);
      return `${origin}${by}^BUN,${hDots},Y,N^FD${clean}^FS`;
    }
    case 'CODE39': {
      const clean = value.toUpperCase();
      return `${origin}${by}^B3N,N,${hDots},Y,N^FD${zplEscape(clean)}^FS`;
    }
    case 'ITF14': {
      const clean = value.replace(/\D/g, '').padStart(14, '0').slice(0, 14);
      return `${origin}${by}^BIN,${hDots},Y,N^FD${clean}^FS`;
    }
    case 'QR': {
      // ^BQN,2,<mag> where mag ~ dots per module. Derive from width.
      const mag = Math.max(2, Math.min(10, Math.round(wDots / 50)));
      return `${origin}^BQN,2,${mag}^FDQA,${zplEscape(value)}^FS`;
    }
    case 'DATAMATRIX': {
      // ^BX orientation, height (dot), quality
      const height = Math.max(4, Math.round(hDots / 20));
      return `${origin}^BXN,${height},200^FD${zplEscape(value)}^FS`;
    }
    case 'GS1_128': {
      // Mode N = UCC/EAN Code 128. Parentheses in the payload are treated as AIs.
      // Zebra expects FNC1 markers via the `>;` sequence, but most firmware
      // accepts parenthesised AIs when mode=N.
      return `${origin}${by}^BCN,${hDots},Y,N,N,N^FD${zplEscape(value)}^FS`;
    }
    case 'CODE128':
    case 'AUTO':
    default:
      return `${origin}${by}^BCN,${hDots},Y,N,N^FD${zplEscape(value)}^FS`;
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function mm2dots(mm: number, dotsPerMm: number): number {
  return Math.max(0, Math.round(mm * dotsPerMm));
}

/**
 * Escape ZPL control characters. By default ZPL uses ^ (caret) as the command
 * prefix and ~ as tilde-command prefix; user-supplied text with those chars
 * would confuse the parser. `\&` ends a field on older firmware, so sanitize
 * that too. Also strip newlines (printer collapses them anyway).
 */
function zplEscape(input: string): string {
  return String(input)
    .replace(/[\\^~]/g, ' ')
    .replace(/\r?\n/g, ' ');
}
