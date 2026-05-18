/**
 * LABEL DOCUMENT BUILDER
 *
 * Assembles printable label sheets/rolls as HTML. Each label cell embeds a
 * real SVG barcode rendered by lib/barcode-renderer. HTML is consumed by:
 *   1. Puppeteer to generate a PDF (in app/api/labels/print), and
 *   2. The browser directly (window.print) for quick previewing.
 *
 * Phase 1: A4 sticker sheets + continuous roll (HTML/PDF only).
 * Phase 3 layers a template-driven field set on top; Phase 4 adds ZPL.
 */

import {
  renderBarcodeSVG,
  barcodeTypeToSymbology,
  type LabelSymbology,
  buildGS1Payload,
} from './barcode-renderer';
import type { BarcodeType } from './barcode-validator';

// ============================================================================
// TYPES
// ============================================================================

export type LabelFormat = 'A4_SHEET' | 'ROLL';

export interface LabelTemplate {
  id?: string;
  name: string;
  format: LabelFormat;
  /** Label width in mm. */
  widthMm: number;
  /** Label height in mm. */
  heightMm: number;
  /** Only for A4_SHEET. */
  columns?: number;
  rows?: number;
  gapXmm?: number;
  gapYmm?: number;
  marginTopMm?: number;
  marginLeftMm?: number;
  /** Which fields to show on each label, ordered top-to-bottom. */
  fields: LabelFieldConfig[];
  symbology: LabelSymbology;
}

export type LabelFieldKey =
  | 'business_name'
  | 'product_name'
  | 'variant_name'
  | 'brand'
  | 'barcode'
  | 'barcode_text'
  | 'price'
  | 'mrp'
  | 'hsn'
  | 'batch'
  | 'mfg'
  | 'expiry'
  | 'net_quantity'
  | 'fssai'
  | 'country_of_origin';

export interface LabelFieldConfig {
  key: LabelFieldKey;
  visible: boolean;
  fontSize?: number;
  bold?: boolean;
  /** Absolute position (mm) relative to the top-left of the label cell. */
  x_mm?: number;
  y_mm?: number;
  w_mm?: number;
  h_mm?: number;
  align?: 'left' | 'center' | 'right';
  /** Optional text printed before the value (e.g. "MRP "). */
  prefix?: string | null;
  /** Optional text printed after the value. */
  suffix?: string | null;
}

export interface LabelLine {
  /** Display name of the product. Falls back to item name. */
  productName: string;
  /** Optional variant name shown as `-&nbsp;<variant>`. */
  variantName?: string;
  /** Barcode value to render. */
  barcode: string;
  /** Symbology override for this line (falls back to template). */
  barcodeType?: BarcodeType | null;
  /** Selling price (₹). */
  price?: number | null;
  /** MRP printed separately when different from price. */
  mrp?: number | null;
  /** Number of labels to print for this line. */
  copies: number;
  /** Optional extra fields (surfaced when template requests them). */
  hsn?: string | null;
  brand?: string | null;
  batchNumber?: string | null;
  mfgDate?: Date | null;
  expiryDate?: Date | null;
  netQuantity?: string | null;
  fssai?: string | null;
  countryOfOrigin?: string | null;
  /** When true, render the barcode as GS1-128 with batch/expiry AIs. */
  encodeGs1?: boolean;
}

export interface BuildLabelDocumentArgs {
  template: LabelTemplate;
  lines: LabelLine[];
  businessName: string;
}

// ============================================================================
// DEFAULTS
// ============================================================================

/** System default template used when caller doesn't supply one. */
export const DEFAULT_ROLL_TEMPLATE: LabelTemplate = {
  name: 'Default Roll 50×25mm',
  format: 'ROLL',
  widthMm: 50,
  heightMm: 25,
  marginTopMm: 2,
  marginLeftMm: 2,
  fields: [
    { key: 'business_name', visible: true, fontSize: 6 },
    { key: 'brand', visible: true, fontSize: 7 },
    { key: 'product_name', visible: true, fontSize: 9, bold: true },
    { key: 'net_quantity', visible: true, fontSize: 6 },
    { key: 'barcode', visible: true },
    { key: 'barcode_text', visible: true, fontSize: 8, bold: true },
    { key: 'price', visible: true, fontSize: 9, bold: true },
    { key: 'mrp', visible: true, fontSize: 6 },
    { key: 'batch', visible: true },
    { key: 'mfg', visible: true },
    { key: 'expiry', visible: true },
    { key: 'country_of_origin', visible: true },
    { key: 'fssai', visible: true, fontSize: 5 },
  ],
  symbology: 'AUTO',
};

export const DEFAULT_A4_TEMPLATE: LabelTemplate = {
  name: 'Default A4 21-up (63.5×38.1mm)',
  format: 'A4_SHEET',
  widthMm: 63.5,
  heightMm: 38.1,
  columns: 3,
  rows: 7,
  gapXmm: 2.5,
  gapYmm: 0,
  marginTopMm: 10,
  marginLeftMm: 7.75,
  fields: [
    { key: 'business_name', visible: true, fontSize: 7 },
    { key: 'brand', visible: true, fontSize: 8 },
    { key: 'product_name', visible: true, fontSize: 9, bold: true },
    { key: 'net_quantity', visible: true, fontSize: 7 },
    { key: 'barcode', visible: true },
    { key: 'barcode_text', visible: true, fontSize: 8, bold: true },
    { key: 'price', visible: true, fontSize: 10, bold: true },
    { key: 'mrp', visible: true, fontSize: 7 },
    { key: 'batch', visible: true },
    { key: 'mfg', visible: true },
    { key: 'expiry', visible: true },
    { key: 'country_of_origin', visible: true },
    { key: 'fssai', visible: true, fontSize: 6 },
  ],
  symbology: 'AUTO',
};

// ============================================================================
// MAIN
// ============================================================================

/**
 * Build a complete printable HTML document for a batch of labels.
 */
export function buildLabelDocumentHtml(args: BuildLabelDocumentArgs): string {
  const { template, lines, businessName } = args;

  const cells: string[] = [];
  for (const line of lines) {
    const copies = Math.max(1, Math.floor(line.copies || 1));
    const html = renderLabelCell(template, line, businessName);
    for (let i = 0; i < copies; i++) cells.push(html);
  }

  if (template.format === 'A4_SHEET') {
    return a4SheetHtml(template, cells);
  }
  return rollHtml(template, cells);
}

// ============================================================================
// CELL RENDERING
// ============================================================================

function esc(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtCurrency(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '';
  return `₹ ${Number(v).toFixed(2)}`;
}

function fmtDateShort(d: Date | null | undefined): string {
  if (!d) return '';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
  return `${mm}/${yy}`;
}

function pickBarcodeValueAndSymbology(
  line: LabelLine,
  template: LabelTemplate
): { value: string; symbology: LabelSymbology } {
  // GS1-128 encoding if requested and we have the required bits.
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

function renderLabelCell(
  template: LabelTemplate,
  line: LabelLine,
  businessName: string
): string {
  const widthMm = template.widthMm;
  const heightMm = template.heightMm;

  const { value, symbology } = pickBarcodeValueAndSymbology(line, template);

  // Detect layout mode. If *any* visible field carries absolute coords,
  // switch to the absolute-positioned renderer; otherwise fall back to the
  // legacy stacked (flexbox) layout so older templates keep working.
  const usesAbsoluteLayout = template.fields.some(
    (f) =>
      f.visible &&
      typeof f.x_mm === 'number' &&
      typeof f.y_mm === 'number' &&
      typeof f.w_mm === 'number' &&
      typeof f.h_mm === 'number'
  );

  if (usesAbsoluteLayout) {
    return renderLabelCellAbsolute(template, line, businessName, value, symbology);
  }

  // Barcode cell gets ~45% of label height; leave room for text rows.
  const barcodeHeightMm = Math.max(6, heightMm * 0.38);

  let barcodeSVG = '';
  try {
    barcodeSVG = renderBarcodeSVG(value, symbology, {
      widthMm: widthMm - 4,
      heightMm: barcodeHeightMm,
      includeText: false,
      textSize: 0,
      scale: 2,
    });
  } catch (err) {
    // Render an error cell but keep the sheet building to avoid blanking out.
    barcodeSVG = `<div style="color:#b00;font-size:7px;padding:2px;text-align:center;">Invalid barcode: ${esc(
      (err as Error).message
    )}</div>`;
  }

  const fieldsByKey = new Map<LabelFieldKey, LabelFieldConfig>();
  for (const f of template.fields) fieldsByKey.set(f.key, f);

  const show = (key: LabelFieldKey) =>
    fieldsByKey.get(key)?.visible === true;
  const fontOf = (key: LabelFieldKey, fallback: number): number =>
    fieldsByKey.get(key)?.fontSize ?? fallback;
  const boldOf = (key: LabelFieldKey): string =>
    fieldsByKey.get(key)?.bold ? '600' : '400';

  const rows: string[] = [];

  if (show('business_name') && businessName) {
    rows.push(
      `<div style="font-size:${fontOf(
        'business_name',
        6
      )}pt;font-weight:${boldOf(
        'business_name'
      )};text-transform:uppercase;color:#555;line-height:1.1;">${esc(
        businessName
      )}</div>`
    );
  }

  if (show('brand') && line.brand) {
    rows.push(
      `<div style="font-size:${fontOf(
        'brand',
        7
      )}pt;font-weight:${boldOf('brand')};color:#333;line-height:1.1;">${esc(
        line.brand
      )}</div>`
    );
  }

  if (show('product_name')) {
    const productLabel = line.variantName
      ? `${line.productName} - ${line.variantName}`
      : line.productName;
    rows.push(
      `<div style="font-size:${fontOf(
        'product_name',
        9
      )}pt;font-weight:${boldOf(
        'product_name'
      )};line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(
        productLabel
      )}</div>`
    );
  }

  if (show('net_quantity') && line.netQuantity) {
    rows.push(
      `<div style="font-size:${fontOf(
        'net_quantity',
        7
      )}pt;color:#444;line-height:1.1;">Net: ${esc(line.netQuantity)}</div>`
    );
  }

  // Barcode SVG block
  if (show('barcode')) {
    rows.push(
      `<div style="display:flex;justify-content:center;align-items:center;margin:1mm 0;">${barcodeSVG}</div>`
    );
  }

  if (show('barcode_text')) {
    rows.push(
      `<div style="font-family:'Courier New',monospace;letter-spacing:1px;font-size:${fontOf(
        'barcode_text',
        8
      )}pt;font-weight:${boldOf(
        'barcode_text'
      )};text-align:center;line-height:1;">${esc(line.barcode)}</div>`
    );
  }

  const priceRow: string[] = [];
  if (show('price') && line.price != null) {
    priceRow.push(
      `<span style="font-size:${fontOf('price', 10)}pt;font-weight:${boldOf(
        'price'
      )};">${fmtCurrency(line.price)}</span>`
    );
  }
  if (show('mrp') && line.mrp != null) {
    priceRow.push(
      `<span style="font-size:${fontOf(
        'mrp',
        7
      )}pt;color:#444;">MRP ${fmtCurrency(line.mrp)}</span>`
    );
  }
  if (priceRow.length) {
    rows.push(
      `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:4px;line-height:1.1;">${priceRow.join(
        ''
      )}</div>`
    );
  }

  const metaRow: string[] = [];
  if (show('hsn') && line.hsn)
    metaRow.push(`HSN: ${esc(line.hsn)}`);
  if (show('batch') && line.batchNumber)
    metaRow.push(`Batch: ${esc(line.batchNumber)}`);
  if (show('mfg') && line.mfgDate)
    metaRow.push(`MFG: ${fmtDateShort(line.mfgDate)}`);
  if (show('expiry') && line.expiryDate)
    metaRow.push(`EXP: ${fmtDateShort(line.expiryDate)}`);
  if (show('country_of_origin') && line.countryOfOrigin)
    metaRow.push(`${esc(line.countryOfOrigin)}`);
  if (metaRow.length) {
    rows.push(
      `<div style="font-size:6pt;color:#555;line-height:1.1;text-align:center;">${metaRow.join(
        ' | '
      )}</div>`
    );
  }
  if (show('fssai') && line.fssai) {
    rows.push(
      `<div style="font-size:${fontOf(
        'fssai',
        6
      )}pt;color:#555;line-height:1.1;text-align:center;">FSSAI ${esc(
        line.fssai
      )}</div>`
    );
  }

  return `<div class="label-cell" style="width:${widthMm}mm;height:${heightMm}mm;padding:1mm;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;overflow:hidden;page-break-inside:avoid;break-inside:avoid;background:#fff;">
    ${rows.join('')}
  </div>`;
}

// ============================================================================
// ABSOLUTE-POSITIONED CELL (Phase-3 designer output)
// ============================================================================

/**
 * Resolve the text/image value for a single field key on a specific line.
 * Returns the raw string (or null for barcode which is rendered as SVG).
 */
function resolveFieldValue(
  key: LabelFieldKey,
  line: LabelLine,
  businessName: string
): string | null {
  switch (key) {
    case 'business_name':
      return businessName || '';
    case 'brand':
      return line.brand || '';
    case 'product_name':
      return line.variantName
        ? `${line.productName} - ${line.variantName}`
        : line.productName;
    case 'variant_name':
      return line.variantName || '';
    case 'barcode_text':
      return line.barcode;
    case 'price':
      return line.price != null ? fmtCurrency(line.price) : '';
    case 'mrp':
      return line.mrp != null ? fmtCurrency(line.mrp) : '';
    case 'hsn':
      return line.hsn || '';
    case 'batch':
      return line.batchNumber || '';
    case 'mfg':
      return fmtDateShort(line.mfgDate);
    case 'expiry':
      return fmtDateShort(line.expiryDate);
    case 'net_quantity':
      return line.netQuantity || '';
    case 'fssai':
      return line.fssai || '';
    case 'country_of_origin':
      return line.countryOfOrigin || '';
    case 'barcode':
      return null; // handled separately as SVG
    default:
      return '';
  }
}

function renderLabelCellAbsolute(
  template: LabelTemplate,
  line: LabelLine,
  businessName: string,
  barcodeValue: string,
  symbology: LabelSymbology
): string {
  const widthMm = template.widthMm;
  const heightMm = template.heightMm;

  const parts: string[] = [];

  for (const f of template.fields) {
    if (!f.visible) continue;
    const x = f.x_mm ?? 0;
    const y = f.y_mm ?? 0;
    const w = f.w_mm ?? Math.max(0, widthMm - x);
    const h = f.h_mm ?? 6;
    const align = f.align || 'left';
    const weight = f.bold ? '600' : '400';
    const font = f.fontSize ?? 8;

    if (f.key === 'barcode') {
      let svg = '';
      try {
        svg = renderBarcodeSVG(barcodeValue, symbology, {
          widthMm: w,
          heightMm: h,
          includeText: false,
          textSize: 0,
          scale: 2,
        });
      } catch (err) {
        svg = `<div style="color:#b00;font-size:6pt;">Invalid barcode: ${esc(
          (err as Error).message
        )}</div>`;
      }
      parts.push(
        `<div style="position:absolute;left:${x}mm;top:${y}mm;width:${w}mm;height:${h}mm;display:flex;align-items:center;justify-content:center;overflow:hidden;">${svg}</div>`
      );
      continue;
    }

    const raw = resolveFieldValue(f.key, line, businessName);
    if (raw === null) continue;
    // Hide empty text fields entirely so the label doesn't show stray prefixes.
    if (!String(raw).trim()) continue;

    const textContent = `${f.prefix || ''}${raw}${f.suffix || ''}`;
    const monospace =
      f.key === 'barcode_text' ? "font-family:'Courier New',monospace;letter-spacing:1px;" : '';
    parts.push(
      `<div style="position:absolute;left:${x}mm;top:${y}mm;width:${w}mm;height:${h}mm;font-size:${font}pt;font-weight:${weight};text-align:${align};line-height:1.1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;${monospace}">${esc(
        textContent
      )}</div>`
    );
  }

  return `<div class="label-cell" style="position:relative;width:${widthMm}mm;height:${heightMm}mm;box-sizing:border-box;overflow:hidden;page-break-inside:avoid;break-inside:avoid;background:#fff;">${parts.join(
    ''
  )}</div>`;
}

// ============================================================================
// A4 SHEET LAYOUT
// ============================================================================

function a4SheetHtml(template: LabelTemplate, cells: string[]): string {
  const columns = template.columns ?? 3;
  const rows = template.rows ?? 7;
  const gapX = template.gapXmm ?? 2.5;
  const gapY = template.gapYmm ?? 0;
  const mTop = template.marginTopMm ?? 10;
  const mLeft = template.marginLeftMm ?? 7;
  const perPage = columns * rows;

  // Group cells into pages so @page breaks line up with the grid.
  const pages: string[] = [];
  for (let i = 0; i < cells.length; i += perPage) {
    const pageCells = cells.slice(i, i + perPage);
    pages.push(
      `<div class="label-page" style="page-break-after:always;padding-top:${mTop}mm;padding-left:${mLeft}mm;">
         <div style="display:grid;grid-template-columns:repeat(${columns}, ${template.widthMm}mm);column-gap:${gapX}mm;row-gap:${gapY}mm;">
           ${pageCells.join('')}
         </div>
       </div>`
    );
  }

  return buildHtmlShell(pages.join(''), 'A4');
}

// ============================================================================
// ROLL LAYOUT
// ============================================================================

function rollHtml(template: LabelTemplate, cells: string[]): string {
  // Each label is its own "page" for continuous-roll printers and for
  // browsers that honour @page size.
  const pages = cells
    .map(
      (c) =>
        `<div class="label-page" style="page-break-after:always;width:${template.widthMm}mm;height:${template.heightMm}mm;">${c}</div>`
    )
    .join('');
  return buildHtmlShell(pages, `${template.widthMm}mm ${template.heightMm}mm`);
}

// ============================================================================
// HTML SHELL
// ============================================================================

function buildHtmlShell(inner: string, pageSize: string): string {
  return `<!doctype html>
<html><head>
<meta charset="utf-8"/>
<title>Barcode Labels</title>
<style>
  @page { size: ${pageSize}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:#fff; font-family: Arial, sans-serif; color:#111; }
  .label-cell { border: 0; }
  .label-cell svg { width: 100% !important; height: auto !important; max-height: 100%; display:block; }
  .print-bar { position:fixed; top:8px; right:8px; background:#0070f3; color:#fff; padding:8px 14px; border-radius:4px; border:0; cursor:pointer; font-size:14px; }
  @media print { .print-bar { display:none; } }
</style>
</head>
<body>
<button class="print-bar" onclick="window.print()">Print</button>
${inner}
</body></html>`;
}
