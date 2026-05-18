/**
 * LABEL -> ESC/POS
 *
 * Converts our `LabelLine[]` (the same data model consumed by the PDF/ZPL
 * renderers) into an ESC/POS byte stream suitable for a 58mm or 80mm
 * thermal printer.
 *
 * Design notes
 * ------------
 *   - We do NOT honour the template's absolute-positioned layout here.
 *     Thermal receipt printers print top-to-bottom line by line; the A4
 *     "designer" template grid doesn't map onto them. Instead we derive a
 *     natural vertical layout from which fields the template marks visible.
 *   - Barcodes are rendered using the printer's NATIVE barcode command
 *     whenever the symbology is supported (EAN-13, UPC-A, CODE-128,
 *     CODE-39, QR). Other symbologies are silently substituted with
 *     CODE-128 — a safe choice since CODE-128 can encode any ASCII string.
 *   - Copies are repeated inside a single byte stream separated by a small
 *     feed + dotted separator so the cashier can tear them apart. Most BT
 *     printers don't have cutters, so we avoid `cut()` for labels.
 *
 * Why not bwip-js on the client
 * -----------------------------
 * bwip-js pulls in ~400KB gzipped. Keeping it server-only means the mobile
 * page stays lean; if we ever need DataMatrix or unusual symbologies we can
 * add a dynamic import.
 */

import type { LabelTemplate, LabelLine, LabelFieldConfig, LabelFieldKey } from '../label-document-builder';
import type { LabelSymbology } from '../barcode-renderer';
import { EscPosBuilder, type BarcodeKind } from './escpos';

export interface BuildLabelEscPosArgs {
  template: LabelTemplate;
  lines: LabelLine[];
  businessName: string;
  /** 58 or 80. Falls back to 58 if unspecified. */
  paperWidthMm?: 58 | 80;
}

/**
 * Build the full print stream for a set of label lines. Each `LabelLine`
 * with `copies = N` yields N labels separated by a thin dotted divider.
 */
export function buildLabelEscPos(args: BuildLabelEscPosArgs): Uint8Array {
  const paper = args.paperWidthMm ?? 58;
  const builder = new EscPosBuilder({ paperWidthMm: paper });
  builder.init();

  let isFirst = true;
  for (const line of args.lines) {
    const copies = Math.max(1, Math.floor(line.copies || 1));
    for (let i = 0; i < copies; i++) {
      if (!isFirst) {
        // Separator between labels — thin dotted line + small feed so the
        // cashier can tear/cut along it.
        builder.align('center').line('. . . . . . . . . . . . . . . .').feed(1);
      }
      emitOneLabel(builder, args.template, line, args.businessName);
      isFirst = false;
    }
  }

  builder.feed(4);
  return builder.build();
}

// ---------------------------------------------------------------------------
// Internal: render a single label
// ---------------------------------------------------------------------------

function emitOneLabel(
  b: EscPosBuilder,
  template: LabelTemplate,
  line: LabelLine,
  businessName: string
): void {
  const visible = new Set<LabelFieldKey>(
    (template.fields || [])
      .filter((f) => f.visible !== false)
      .map((f) => f.key)
  );
  // Receipt printers print top-to-bottom, so the "designer" order is
  // irrelevant — we enforce a sensible retail reading order here.

  // Business name (small, centered) — always keep it for branding.
  if (businessName && (visible.has('business_name') || visible.size === 0)) {
    b.align('center').size(1, 1).bold(false).line(trunc(businessName, b.colsFontA));
  }

  // Brand (italic-style placeholder — BT printers have no italic; just small).
  if (line.brand && visible.has('brand')) {
    b.align('center').size(1, 1).line(trunc(line.brand, b.colsFontA));
  }

  // Product name (tall + bold, centered).
  if (visible.has('product_name') || visible.size === 0) {
    b.align('center').bold(true);
    const long = line.productName.length > 18;
    if (long) b.sizeTall();
    else b.sizeBig();
    b.line(trunc(line.productName, long ? b.colsFontA : Math.max(8, Math.floor(b.colsFontA / 2))));
    b.sizeNormal().bold(false);
  }

  // Variant name.
  if (line.variantName && visible.has('variant_name')) {
    b.align('center').line(trunc(line.variantName, b.colsFontA));
  }

  // Prices — prefer MRP when both exist since that's what the consumer sees.
  if (line.mrp != null && visible.has('mrp')) {
    b.align('center').bold(true).sizeTall();
    b.line(`MRP Rs ${line.mrp.toFixed(2)}`);
    b.sizeNormal().bold(false);
  } else if (line.price != null && visible.has('price')) {
    b.align('center').bold(true).sizeTall();
    b.line(`Rs ${line.price.toFixed(2)}`);
    b.sizeNormal().bold(false);
  }

  // Net quantity + HSN condensed into a two-column line (space permitting).
  const inlineLeft: string[] = [];
  const inlineRight: string[] = [];
  if (line.netQuantity && visible.has('net_quantity')) inlineLeft.push(`Qty ${line.netQuantity}`);
  if (line.hsn && visible.has('hsn')) inlineRight.push(`HSN ${line.hsn}`);
  if (inlineLeft.length || inlineRight.length) {
    b.align('left').sizeNormal().bold(false);
    b.twoColumn(inlineLeft.join(' '), inlineRight.join(' '));
  }

  // Batch / MFG / EXP — only emit rows that have data.
  const batchLine: string[] = [];
  if (line.batchNumber && visible.has('batch')) batchLine.push(`B:${line.batchNumber}`);
  if (line.mfgDate && visible.has('mfg')) batchLine.push(`MFG ${fmtDateShort(line.mfgDate)}`);
  if (line.expiryDate && visible.has('expiry')) batchLine.push(`EXP ${fmtDateShort(line.expiryDate)}`);
  if (batchLine.length) {
    b.align('center').line(trunc(batchLine.join('  '), b.colsFontA));
  }

  if (line.countryOfOrigin && visible.has('country_of_origin')) {
    b.align('center').line(`Origin: ${trunc(line.countryOfOrigin, b.colsFontA - 8)}`);
  }
  if (line.fssai && visible.has('fssai')) {
    b.align('center').line(`FSSAI ${trunc(line.fssai, b.colsFontA - 6)}`);
  }

  // Barcode.
  if (line.barcode && visible.has('barcode')) {
    b.align('center');
    emitBarcode(b, line.barcode, template.symbology, line.barcodeType ?? null);
    if (visible.has('barcode_text')) {
      b.align('center').sizeNormal().line(trunc(line.barcode, b.colsFontA));
    }
  }

  b.feed(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trunc(text: string, maxLen: number): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, Math.max(0, maxLen - 1)) + '…';
}

function fmtDateShort(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

/**
 * Decide which native ESC/POS 1D symbology to use, or fall back to QR when
 * the requested symbology is QR. GS1-128 and any exotic symbology are
 * rendered as CODE-128 with the raw payload — the bars will be correct,
 * and the human-readable text shown below is the same value.
 */
function emitBarcode(
  b: EscPosBuilder,
  code: string,
  templateSymbology: LabelSymbology,
  itemBarcodeType: string | null
): void {
  const sym = (templateSymbology || 'AUTO') as LabelSymbology;
  const itemType = (itemBarcodeType || '').toUpperCase();

  if (sym === 'QR' || itemType === 'QR') {
    b.qrcode(code, { size: 6, ecLevel: 'M' });
    return;
  }

  let kind: BarcodeKind = 'CODE128';
  if (sym === 'EAN13' || itemType === 'EAN13') {
    if (/^\d{12,13}$/.test(code)) kind = 'EAN13';
  } else if (sym === 'UPC' || itemType === 'UPC') {
    if (/^\d{11,12}$/.test(code)) kind = 'UPCA';
  } else if (sym === 'CODE39' || itemType === 'CODE39') {
    kind = 'CODE39';
  } else if (sym === 'AUTO') {
    if (/^\d{13}$/.test(code)) kind = 'EAN13';
    else if (/^\d{12}$/.test(code)) kind = 'UPCA';
    else kind = 'CODE128';
  }

  // EAN-13 expects exactly 12 digits (printer computes the 13th check digit)
  // OR all 13. Pad when needed.
  let payload = code;
  if (kind === 'EAN13' && payload.length === 13) {
    payload = payload.slice(0, 12);
  }

  b.barcode(kind, payload, { height: 80, width: 2, hri: 'below' });
}
