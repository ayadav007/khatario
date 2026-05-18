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

import type {
  LabelTemplate,
  LabelLine,
  LabelFieldConfig,
  LabelFieldKey,
} from './label-document-builder';
import type { LabelSymbology } from './barcode-renderer';
import { buildGS1Payload, barcodeTypeToSymbology } from './barcode-renderer';

// ============================================================================
// PUBLIC API
// ============================================================================

export interface BuildZplArgs {
  template: LabelTemplate;
  lines: LabelLine[];
  businessName: string;
  /** Printer head resolution (dots/inch). Default 203. */
  dpi?: 203 | 300 | 600;
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

  // Job header: set default dpi / units. ^CI28 switches to UTF-8 so Indian
  // rupee, accented characters, etc. print correctly.
  chunks.push('^XA^CI28^XZ');

  for (const line of lines) {
    const copies = Math.max(1, Math.floor(line.copies || 1));
    const labelZpl = renderSingleLabelZpl(template, line, businessName, dotsPerMm);
    for (let i = 0; i < copies; i++) {
      chunks.push(labelZpl);
    }
  }

  return chunks.join('\n');
}

// ============================================================================
// INTERNAL - SINGLE LABEL
// ============================================================================

function renderSingleLabelZpl(
  template: LabelTemplate,
  line: LabelLine,
  businessName: string,
  dotsPerMm: number
): string {
  const widthDots = mm2dots(template.widthMm, dotsPerMm);
  const heightDots = mm2dots(template.heightMm, dotsPerMm);

  const header = [
    '^XA',
    // Print width in dots (helps the firmware register the label correctly).
    `^PW${widthDots}`,
    // Label length in dots.
    `^LL${heightDots}`,
    // Label home at 0,0 (top-left).
    '^LH0,0',
  ].join('');

  const { value, symbology } = pickBarcodeValueAndSymbology(line, template);

  const usesAbsoluteLayout = template.fields.some(
    (f) =>
      f.visible &&
      typeof f.x_mm === 'number' &&
      typeof f.y_mm === 'number' &&
      typeof f.w_mm === 'number' &&
      typeof f.h_mm === 'number'
  );

  const body = usesAbsoluteLayout
    ? renderAbsoluteLabel(template, line, businessName, value, symbology, dotsPerMm)
    : renderStackedLabel(template, line, businessName, value, symbology, dotsPerMm);

  return `${header}${body}^XZ`;
}

// ============================================================================
// ABSOLUTE-POSITIONED LAYOUT (Phase-3 designer output)
// ============================================================================

function renderAbsoluteLabel(
  template: LabelTemplate,
  line: LabelLine,
  businessName: string,
  barcodeValue: string,
  symbology: LabelSymbology,
  dotsPerMm: number
): string {
  const parts: string[] = [];

  for (const field of template.fields) {
    if (!field.visible) continue;
    // Absolute-positioned fields must have all four coords.
    if (
      typeof field.x_mm !== 'number' ||
      typeof field.y_mm !== 'number' ||
      typeof field.w_mm !== 'number' ||
      typeof field.h_mm !== 'number'
    ) {
      continue;
    }

    const x = mm2dots(field.x_mm, dotsPerMm);
    const y = mm2dots(field.y_mm, dotsPerMm);
    const w = mm2dots(field.w_mm, dotsPerMm);
    const h = mm2dots(field.h_mm, dotsPerMm);

    if (field.key === 'barcode') {
      parts.push(barcodeCommand(barcodeValue, symbology, x, y, w, h));
    } else {
      const text = resolveFieldValueForZpl(field.key, line, businessName, field);
      if (!text) continue;
      parts.push(textCommand(text, x, y, w, h, field));
    }
  }

  return parts.join('');
}

// ============================================================================
// LEGACY STACKED LAYOUT
// ============================================================================

function renderStackedLabel(
  template: LabelTemplate,
  line: LabelLine,
  businessName: string,
  barcodeValue: string,
  symbology: LabelSymbology,
  dotsPerMm: number
): string {
  const padMm = 1.5;
  const innerWidthMm = Math.max(template.widthMm - 2 * padMm, 10);
  const innerHeightMm = Math.max(template.heightMm - 2 * padMm, 10);

  const parts: string[] = [];
  let cursorMm = padMm;

  const fieldsByKey = new Map<LabelFieldKey, LabelFieldConfig>();
  for (const f of template.fields) fieldsByKey.set(f.key, f);

  const show = (k: LabelFieldKey) => fieldsByKey.get(k)?.visible === true;

  // Business name (top)
  if (show('business_name') && businessName) {
    const f = fieldsByKey.get('business_name')!;
    const hMm = Math.max(2, (f.fontSize ?? 6) * 0.4);
    parts.push(
      textCommand(
        businessName.toUpperCase(),
        mm2dots(padMm, dotsPerMm),
        mm2dots(cursorMm, dotsPerMm),
        mm2dots(innerWidthMm, dotsPerMm),
        mm2dots(hMm, dotsPerMm),
        f
      )
    );
    cursorMm += hMm + 0.3;
  }

  // Product name
  if (show('product_name')) {
    const f = fieldsByKey.get('product_name')!;
    const hMm = Math.max(3, (f.fontSize ?? 9) * 0.45);
    const name = line.variantName
      ? `${line.productName} - ${line.variantName}`
      : line.productName;
    parts.push(
      textCommand(
        name,
        mm2dots(padMm, dotsPerMm),
        mm2dots(cursorMm, dotsPerMm),
        mm2dots(innerWidthMm, dotsPerMm),
        mm2dots(hMm, dotsPerMm),
        f
      )
    );
    cursorMm += hMm + 0.4;
  }

  // Barcode takes ~45% of remaining height.
  const remainingMm = Math.max(template.heightMm - cursorMm - padMm, 6);
  const barcodeHeightMm = Math.max(6, remainingMm * 0.45);
  if (show('barcode')) {
    parts.push(
      barcodeCommand(
        barcodeValue,
        symbology,
        mm2dots(padMm, dotsPerMm),
        mm2dots(cursorMm, dotsPerMm),
        mm2dots(innerWidthMm, dotsPerMm),
        mm2dots(barcodeHeightMm, dotsPerMm)
      )
    );
    cursorMm += barcodeHeightMm + 0.5;
  }

  if (show('barcode_text')) {
    const f = fieldsByKey.get('barcode_text')!;
    const hMm = Math.max(2.5, (f.fontSize ?? 8) * 0.4);
    parts.push(
      textCommand(
        line.barcode,
        mm2dots(padMm, dotsPerMm),
        mm2dots(cursorMm, dotsPerMm),
        mm2dots(innerWidthMm, dotsPerMm),
        mm2dots(hMm, dotsPerMm),
        { ...f, align: 'center' }
      )
    );
    cursorMm += hMm + 0.3;
  }

  // Price / MRP on one row.
  const priceText = line.price != null ? `Rs ${Number(line.price).toFixed(2)}` : '';
  const mrpText = line.mrp != null ? `MRP ${Number(line.mrp).toFixed(2)}` : '';
  if (priceText || mrpText) {
    const combined = [priceText, mrpText].filter(Boolean).join('   ');
    const hMm = 3.5;
    parts.push(
      textCommand(
        combined,
        mm2dots(padMm, dotsPerMm),
        mm2dots(cursorMm, dotsPerMm),
        mm2dots(innerWidthMm, dotsPerMm),
        mm2dots(hMm, dotsPerMm),
        { key: 'price', visible: true, bold: true }
      )
    );
    cursorMm += hMm + 0.3;
  }

  return parts.join('');
}

// ============================================================================
// COMMAND BUILDERS
// ============================================================================

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

/**
 * Duplicated from label-document-builder so we stay pure (no HTML imports).
 */
function pickBarcodeValueAndSymbology(
  line: LabelLine,
  template: LabelTemplate
): { value: string; symbology: LabelSymbology } {
  if (line.encodeGs1) {
    const gtin = line.barcode.replace(/\D/g, '').padStart(14, '0').slice(0, 14);
    const payload = buildGS1Payload({
      gtin,
      batch: line.batchNumber ?? null,
      expiry: line.expiryDate ?? null,
    });
    return { value: payload, symbology: 'GS1_128' };
  }
  const sym: LabelSymbology =
    line.barcodeType != null
      ? barcodeTypeToSymbology(line.barcodeType)
      : template.symbology;
  return { value: line.barcode, symbology: sym };
}

function fmtDateShort(d: Date | null | undefined): string {
  if (!d) return '';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
  return `${mm}/${yy}`;
}

function resolveFieldValueForZpl(
  key: LabelFieldKey,
  line: LabelLine,
  businessName: string,
  field: LabelFieldConfig
): string {
  let raw: string = '';
  switch (key) {
    case 'business_name':
      raw = businessName || '';
      break;
    case 'brand':
      raw = line.brand || '';
      break;
    case 'product_name':
      raw = line.variantName
        ? `${line.productName} - ${line.variantName}`
        : line.productName;
      break;
    case 'variant_name':
      raw = line.variantName || '';
      break;
    case 'barcode_text':
      raw = line.barcode;
      break;
    case 'price':
      raw =
        line.price != null ? `Rs ${Number(line.price).toFixed(2)}` : '';
      break;
    case 'mrp':
      raw =
        line.mrp != null ? `MRP Rs ${Number(line.mrp).toFixed(2)}` : '';
      break;
    case 'hsn':
      raw = line.hsn ? `HSN ${line.hsn}` : '';
      break;
    case 'batch':
      raw = line.batchNumber ? `Batch ${line.batchNumber}` : '';
      break;
    case 'mfg':
      raw = line.mfgDate ? `MFG ${fmtDateShort(line.mfgDate)}` : '';
      break;
    case 'expiry':
      raw = line.expiryDate ? `EXP ${fmtDateShort(line.expiryDate)}` : '';
      break;
    case 'net_quantity':
      raw = line.netQuantity ? `Net: ${line.netQuantity}` : '';
      break;
    case 'fssai':
      raw = line.fssai ? `FSSAI ${line.fssai}` : '';
      break;
    case 'country_of_origin':
      raw = line.countryOfOrigin || '';
      break;
    default:
      raw = '';
  }
  if (!raw) return '';
  // If the designer set a prefix/suffix (e.g. "MRP ₹"), honour it. Otherwise
  // the per-case defaults above already produce human-readable text.
  return `${field.prefix || ''}${raw}${field.suffix || ''}`;
}
