/**
 * LABEL LAYOUT — printer-language-neutral.
 *
 * Turns a label template + one label line into positioned elements in millimetres. Every label
 * language (ZPL, TSPL, ESC/POS raster) draws the same elements, so a label looks the same whichever
 * printer it goes to.
 *
 *   - Templates from the label designer (every visible field has x/y/w/h) are placed exactly.
 *   - Older stacked templates flow top to bottom: business, product, barcode, barcode text, price/MRP.
 */

import type { LabelTemplate, LabelLine, LabelFieldConfig, LabelFieldKey } from '@/lib/label-document-builder';
import type { LabelSymbology } from '@/lib/barcode-renderer';
import { buildGS1Payload, barcodeTypeToSymbology } from '@/lib/barcode-renderer';

export type LabelTextElement = {
  kind: 'text';
  /** Text without the field's prefix/suffix (emitters add them once). */
  text: string;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  field: Partial<LabelFieldConfig>;
};

export type LabelBarcodeElement = {
  kind: 'barcode';
  value: string;
  symbology: LabelSymbology;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
};

export type LabelElement = LabelTextElement | LabelBarcodeElement;

/** Field text with the field's own prefix and suffix, the way it is printed. */
export function withAffixes(text: string, field: Partial<LabelFieldConfig>): string {
  return `${field.prefix || ''}${text}${field.suffix || ''}`;
}

export function layoutLabel(template: LabelTemplate, line: LabelLine, businessName: string): LabelElement[] {
  const { value, symbology } = pickBarcodeValueAndSymbology(line, template);
  return usesAbsoluteLayout(template)
    ? layoutAbsolute(template, line, businessName, value, symbology)
    : layoutStacked(template, line, businessName, value, symbology);
}

export function usesAbsoluteLayout(template: LabelTemplate): boolean {
  return template.fields.some(
    (f) =>
      f.visible &&
      typeof f.x_mm === 'number' &&
      typeof f.y_mm === 'number' &&
      typeof f.w_mm === 'number' &&
      typeof f.h_mm === 'number',
  );
}

function layoutAbsolute(
  template: LabelTemplate,
  line: LabelLine,
  businessName: string,
  barcodeValue: string,
  symbology: LabelSymbology,
): LabelElement[] {
  const out: LabelElement[] = [];
  for (const field of template.fields) {
    if (!field.visible) continue;
    if (
      typeof field.x_mm !== 'number' ||
      typeof field.y_mm !== 'number' ||
      typeof field.w_mm !== 'number' ||
      typeof field.h_mm !== 'number'
    ) {
      continue;
    }
    const box = { xMm: field.x_mm, yMm: field.y_mm, wMm: field.w_mm, hMm: field.h_mm };
    if (field.key === 'barcode') {
      out.push({ kind: 'barcode', value: barcodeValue, symbology, ...box });
    } else {
      const text = resolveFieldText(field.key, line, businessName);
      if (text) out.push({ kind: 'text', text, field, ...box });
    }
  }
  return out;
}

function layoutStacked(
  template: LabelTemplate,
  line: LabelLine,
  businessName: string,
  barcodeValue: string,
  symbology: LabelSymbology,
): LabelElement[] {
  const padMm = 1.5;
  const innerWidthMm = Math.max(template.widthMm - 2 * padMm, 10);
  const out: LabelElement[] = [];
  let cursorMm = padMm;

  const fieldsByKey = new Map<LabelFieldKey, LabelFieldConfig>();
  for (const f of template.fields) fieldsByKey.set(f.key, f);
  const show = (k: LabelFieldKey) => fieldsByKey.get(k)?.visible === true;

  if (show('business_name') && businessName) {
    const f = fieldsByKey.get('business_name')!;
    const hMm = Math.max(2, (f.fontSize ?? 6) * 0.4);
    out.push({ kind: 'text', text: businessName.toUpperCase(), xMm: padMm, yMm: cursorMm, wMm: innerWidthMm, hMm, field: f });
    cursorMm += hMm + 0.3;
  }

  if (show('product_name')) {
    const f = fieldsByKey.get('product_name')!;
    const hMm = Math.max(3, (f.fontSize ?? 9) * 0.45);
    const name = line.variantName ? `${line.productName} - ${line.variantName}` : line.productName;
    out.push({ kind: 'text', text: name, xMm: padMm, yMm: cursorMm, wMm: innerWidthMm, hMm, field: f });
    cursorMm += hMm + 0.4;
  }

  const remainingMm = Math.max(template.heightMm - cursorMm - padMm, 6);
  const barcodeHeightMm = Math.max(6, remainingMm * 0.45);
  if (show('barcode')) {
    out.push({
      kind: 'barcode',
      value: barcodeValue,
      symbology,
      xMm: padMm,
      yMm: cursorMm,
      wMm: innerWidthMm,
      hMm: barcodeHeightMm,
    });
    cursorMm += barcodeHeightMm + 0.5;
  }

  if (show('barcode_text')) {
    const f = fieldsByKey.get('barcode_text')!;
    const hMm = Math.max(2.5, (f.fontSize ?? 8) * 0.4);
    out.push({
      kind: 'text',
      text: line.barcode,
      xMm: padMm,
      yMm: cursorMm,
      wMm: innerWidthMm,
      hMm,
      field: { ...f, align: 'center' },
    });
    cursorMm += hMm + 0.3;
  }

  const priceText = line.price != null ? `Rs ${Number(line.price).toFixed(2)}` : '';
  const mrpText = line.mrp != null ? `MRP ${Number(line.mrp).toFixed(2)}` : '';
  if (priceText || mrpText) {
    const hMm = 3.5;
    out.push({
      kind: 'text',
      text: [priceText, mrpText].filter(Boolean).join('   '),
      xMm: padMm,
      yMm: cursorMm,
      wMm: innerWidthMm,
      hMm,
      field: { key: 'price', visible: true, bold: true },
    });
  }

  return out;
}

export function pickBarcodeValueAndSymbology(
  line: LabelLine,
  template: LabelTemplate,
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
  const sym: LabelSymbology = line.barcodeType != null ? barcodeTypeToSymbology(line.barcodeType) : template.symbology;
  return { value: line.barcode, symbology: sym };
}

/** MM/YY, the usual date format on Indian product labels. */
export function labelDate(d: Date | null | undefined): string {
  if (!d) return '';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
  return `${mm}/${yy}`;
}

/** The printed value of a designer field (without the field's prefix/suffix). */
export function resolveFieldText(key: LabelFieldKey, line: LabelLine, businessName: string): string {
  switch (key) {
    case 'business_name':
      return businessName || '';
    case 'brand':
      return line.brand || '';
    case 'product_name':
      return line.variantName ? `${line.productName} - ${line.variantName}` : line.productName;
    case 'variant_name':
      return line.variantName || '';
    case 'barcode_text':
      return line.barcode;
    case 'price':
      return line.price != null ? `Rs ${Number(line.price).toFixed(2)}` : '';
    case 'mrp':
      return line.mrp != null ? `MRP Rs ${Number(line.mrp).toFixed(2)}` : '';
    case 'hsn':
      return line.hsn ? `HSN ${line.hsn}` : '';
    case 'batch':
      return line.batchNumber ? `Batch ${line.batchNumber}` : '';
    case 'mfg':
      return line.mfgDate ? `MFG ${labelDate(line.mfgDate)}` : '';
    case 'expiry':
      return line.expiryDate ? `EXP ${labelDate(line.expiryDate)}` : '';
    case 'net_quantity':
      return line.netQuantity ? `Net: ${line.netQuantity}` : '';
    case 'fssai':
      return line.fssai ? `FSSAI ${line.fssai}` : '';
    case 'country_of_origin':
      return line.countryOfOrigin || '';
    default:
      return '';
  }
}
