/**
 * TSPL label output — TSC, Xprinter label (XP-365B…), TVS LP and most other barcode label printers.
 * Same layout as ZPL (lib/print/label-layout.ts). Text the built-in fonts cannot show (Hindi, ₹…)
 * is drawn as a BITMAP when a rasterizer is given.
 *
 * Built-in font sizes assume 203 dpi; on 300 dpi heads the text simply prints smaller.
 * GS1-128 and DataMatrix are best-effort until checked on hardware.
 */

import type { LabelTemplate, LabelLine, LabelFieldConfig } from '@/lib/label-document-builder';
import type { LabelSymbology } from '@/lib/barcode-renderer';
import { layoutLabel, withAffixes } from '@/lib/print/label-layout';
import { bytesPerRow, invertBits, needsRaster, type TextRasterizer } from '@/lib/print/bitmap';

export type BuildTsplArgs = {
  template: LabelTemplate;
  lines: LabelLine[];
  businessName: string;
  dpi?: 203 | 300;
  /** Gap between labels on the roll, mm (die-cut rolls are usually 2–3 mm). */
  gapMm?: number;
  /** Print darkness 0–15. */
  density?: number;
  /** Inches per second. */
  speed?: number;
  rasterize?: TextRasterizer;
};

const FONTS = [
  { id: '1', w: 8, h: 12 },
  { id: '2', w: 12, h: 20 },
  { id: '3', w: 16, h: 24 },
  { id: '4', w: 24, h: 32 },
  { id: '5', w: 32, h: 48 },
] as const;

class Out {
  private parts: Uint8Array[] = [];
  private enc = new TextEncoder();
  text(s: string) {
    this.parts.push(this.enc.encode(s));
  }
  line(s: string) {
    this.text(`${s}\r\n`);
  }
  bytes(b: Uint8Array) {
    this.parts.push(b);
  }
  build(): Uint8Array {
    const total = this.parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

const mmToDots = (mm: number, dpm: number) => Math.max(0, Math.round(mm * dpm));
const quote = (s: string) => `"${s.replace(/"/g, '\\["]')}"`;

/** Built-in font and multiplier for a wanted character height in dots. */
export function pickFont(heightDots: number): { id: string; w: number; h: number; mul: number } {
  let best: (typeof FONTS)[number] = FONTS[0];
  for (const f of FONTS) if (f.h <= heightDots) best = f;
  const mul = Math.max(1, Math.min(10, Math.floor(heightDots / best.h)));
  return { ...best, mul };
}

function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= perLine) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = word.slice(0, perLine);
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = last.length >= perLine ? `${last.slice(0, perLine - 2)}..` : `${last}..`;
    return kept;
  }
  return lines;
}

function alignX(x: number, w: number, contentW: number, align: LabelFieldConfig['align']): number {
  if (align === 'center') return x + Math.max(0, Math.floor((w - contentW) / 2));
  if (align === 'right') return x + Math.max(0, w - contentW);
  return x;
}

function emitText(
  out: Out,
  raw: string,
  field: Partial<LabelFieldConfig>,
  box: { x: number; y: number; w: number; h: number },
  dpi: number,
  rasterize?: TextRasterizer,
) {
  const text = withAffixes(raw, field);
  const pt = field.fontSize ?? 8;
  const charH = Math.max(12, Math.round(pt * 3 * (dpi / 203)));

  if (needsRaster(text) && rasterize) {
    const bmp = rasterize(text, { heightDots: Math.min(box.h, Math.round(charH * 1.3)), bold: field.bold, maxWidthDots: box.w });
    const x = alignX(box.x, box.w, bmp.width, field.align);
    out.text(`BITMAP ${x},${box.y},${bytesPerRow(bmp)},${bmp.height},0,`);
    out.bytes(invertBits(bmp.data));
    out.text('\r\n');
    return;
  }

  const ascii = text.replace(/[₹₨]/g, 'Rs ').replace(/[^\x20-\x7e]/g, '?');
  const font = pickFont(charH);
  const cw = font.w * font.mul;
  const ch = font.h * font.mul;
  const perLine = Math.max(1, Math.floor(box.w / cw));
  const maxLines = Math.max(1, Math.floor(box.h / ch));
  wrap(ascii, perLine, maxLines).forEach((ln, i) => {
    const x = alignX(box.x, box.w, ln.length * cw, field.align);
    const y = box.y + i * ch;
    const cmd = `TEXT ${x},${y},"${font.id}",0,${font.mul},${font.mul},${quote(ln)}`;
    out.line(cmd);
    // Built-in fonts have no bold: a second pass one dot to the right thickens the strokes.
    if (field.bold) out.line(`TEXT ${x + 1},${y},"${font.id}",0,${font.mul},${font.mul},${quote(ln)}`);
  });
}

function barcodeModules(symbology: LabelSymbology, value: string): number {
  switch (symbology) {
    case 'EAN13':
    case 'UPC':
      return 95 + 18;
    case 'EAN8':
      return 67 + 14;
    case 'CODE39':
      return (value.length + 2) * 13 + 20;
    case 'ITF14':
      return 14 * 9 + 30;
    default:
      return 11 * (value.length + 3) + 2 + 20;
  }
}

function emitBarcode(out: Out, value: string, symbology: LabelSymbology, box: { x: number; y: number; w: number; h: number }) {
  const digits = value.replace(/\D/g, '');
  if (symbology === 'QR') {
    const cell = Math.max(2, Math.min(10, Math.floor(Math.min(box.w, box.h) / 29)));
    out.line(`QRCODE ${box.x},${box.y},M,${cell},A,0,${quote(value)}`);
    return;
  }
  if (symbology === 'DATAMATRIX') {
    out.line(`DMATRIX ${box.x},${box.y},${box.w},${box.h},${quote(value)}`);
    return;
  }
  let type = '128';
  let data = value;
  let wideRatio = 1;
  if (symbology === 'EAN13' && digits.length >= 12) [type, data] = ['EAN13', digits.slice(0, 12)];
  else if (symbology === 'UPC' && digits.length >= 11) [type, data] = ['UPCA', digits.slice(0, 11)];
  else if (symbology === 'EAN8' && digits.length >= 7) [type, data] = ['EAN8', digits.slice(0, 7)];
  else if (symbology === 'CODE39') [type, data, wideRatio] = ['39', value.toUpperCase(), 2.5];
  else if (symbology === 'ITF14' && digits.length >= 13) [type, data, wideRatio] = ['ITF14', digits.slice(0, 13), 2.5];
  else if (symbology === 'GS1_128') type = 'EAN128';

  const modules = barcodeModules(symbology, data);
  const narrow = Math.max(1, Math.min(4, Math.floor(box.w / modules)));
  const wide = Math.max(narrow, Math.round(narrow * wideRatio));
  const x = alignX(box.x, box.w, modules * narrow, 'center');
  out.line(`BARCODE ${x},${box.y},"${type}",${box.h},0,0,${narrow},${wide},${quote(data)}`);
}

export function buildLabelTspl(args: BuildTsplArgs): Uint8Array {
  const dpi = args.dpi ?? 203;
  const dpm = dpi / 25.4;
  const { template } = args;
  const out = new Out();
  out.line(`SIZE ${template.widthMm} mm,${template.heightMm} mm`);
  out.line(`GAP ${args.gapMm ?? 2} mm,0 mm`);
  out.line('DIRECTION 1,0');
  out.line('REFERENCE 0,0');
  out.line(`DENSITY ${Math.max(0, Math.min(15, Math.round(args.density ?? 8)))}`);
  out.line(`SPEED ${Math.max(1, Math.min(6, Math.round(args.speed ?? 4)))}`);
  out.line('SET TEAR ON');

  for (const line of args.lines) {
    const copies = Math.max(1, Math.floor(line.copies || 1));
    out.line('CLS');
    for (const el of layoutLabel(template, line, args.businessName)) {
      const box = { x: mmToDots(el.xMm, dpm), y: mmToDots(el.yMm, dpm), w: mmToDots(el.wMm, dpm), h: mmToDots(el.hMm, dpm) };
      if (el.kind === 'barcode') emitBarcode(out, el.value, el.symbology, box);
      else emitText(out, el.text, el.field, box, dpi, args.rasterize);
    }
    out.line(`PRINT 1,${copies}`);
  }
  return out.build();
}
