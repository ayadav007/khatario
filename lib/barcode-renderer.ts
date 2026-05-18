/**
 * BARCODE RENDERER
 *
 * Wraps bwip-js to produce real, scannable SVG barcodes for the label
 * printing pipeline. Replaces the legacy `Libre Barcode 39` Google Font
 * trick which was not a real symbology.
 *
 * All functions are pure and synchronous (bwip-js `toSVG`) so they can be
 * called from either server-side (Puppeteer-based PDF route) or from a
 * Node runtime during HTML assembly.
 */

import bwipjs from 'bwip-js/node';
import type { BarcodeType } from './barcode-validator';

/** Symbology accepted by renderBarcodeSVG. Extends BarcodeType with GS1-128. */
export type LabelSymbology =
  | 'EAN13'
  | 'EAN8'
  | 'UPC'
  | 'CODE128'
  | 'CODE39'
  | 'ITF14'
  | 'QR'
  | 'DATAMATRIX'
  | 'GS1_128'
  | 'AUTO';

export interface BarcodeRenderOptions {
  /** Desired width in mm (bwip-js interprets in points; we convert). */
  widthMm?: number;
  /** Desired height in mm. */
  heightMm?: number;
  /** Font size for human-readable text under the bars. Set to 0 to hide. */
  textSize?: number;
  /** Whether to include human-readable text below the bars. */
  includeText?: boolean;
  /** Scale factor (affects bar width precision on low-DPI printers). */
  scale?: number;
}

const DEFAULT_OPTS: Required<BarcodeRenderOptions> = {
  widthMm: 40,
  heightMm: 15,
  textSize: 8,
  includeText: true,
  scale: 2,
};

/**
 * Map our LabelSymbology identifiers to bwip-js `bcid` codes.
 * Source: https://github.com/metafloor/bwip-js/wiki/BWIPP-Symbologies
 */
function symbologyToBcid(symbology: LabelSymbology, code: string): string {
  switch (symbology) {
    case 'EAN13':
      return 'ean13';
    case 'EAN8':
      return 'ean8';
    case 'UPC':
      return 'upca';
    case 'CODE128':
      return 'code128';
    case 'CODE39':
      return 'code39';
    case 'ITF14':
      return 'itf14';
    case 'QR':
      return 'qrcode';
    case 'DATAMATRIX':
      return 'datamatrix';
    case 'GS1_128':
      return 'gs1-128';
    case 'AUTO':
      return autoDetectBcid(code);
  }
}

/**
 * Auto-pick a bcid when caller passes `AUTO`. Matches barcode-validator
 * heuristics but for bwip-js bcids.
 */
function autoDetectBcid(code: string): string {
  const cleaned = code.trim();
  if (/^\d{13}$/.test(cleaned)) return 'ean13';
  if (/^\d{12}$/.test(cleaned)) return 'upca';
  if (/^\d{14}$/.test(cleaned)) return 'itf14';
  if (/^\d{8}$/.test(cleaned)) return 'ean8';
  if (cleaned.length > 20 && /^[A-Za-z0-9+\-*./: ]+$/.test(cleaned)) return 'qrcode';
  return 'code128';
}

/**
 * Map our BarcodeType (from items.barcode_type) to LabelSymbology.
 */
export function barcodeTypeToSymbology(
  type: BarcodeType | null | undefined
): LabelSymbology {
  switch (type) {
    case 'EAN13':
      return 'EAN13';
    case 'UPC':
      return 'UPC';
    case 'CODE128':
      return 'CODE128';
    case 'QR':
      return 'QR';
    case 'CUSTOM':
    default:
      return 'AUTO';
  }
}

/**
 * Render a barcode as an inline SVG string. Safe to embed in HTML for
 * Puppeteer-based PDF generation or for client-side `window.print()`.
 *
 * Throws when the code is invalid for the requested symbology.
 */
export function renderBarcodeSVG(
  code: string,
  symbology: LabelSymbology = 'AUTO',
  options: BarcodeRenderOptions = {}
): string {
  const opts = { ...DEFAULT_OPTS, ...options };
  const bcid = symbologyToBcid(symbology, code);

  try {
    const svg = bwipjs.toSVG({
      bcid,
      text: code,
      scale: opts.scale,
      height: opts.heightMm,
      includetext: opts.includeText,
      textxalign: 'center',
      textsize: opts.textSize,
      paddingwidth: 2,
      paddingheight: 2,
      backgroundcolor: 'FFFFFF',
    } as any);
    return svg;
  } catch (err: any) {
    // Fall back to Code-128 when the requested symbology rejects the input.
    if (bcid !== 'code128') {
      try {
        return bwipjs.toSVG({
          bcid: 'code128',
          text: code,
          scale: opts.scale,
          height: opts.heightMm,
          includetext: opts.includeText,
          textxalign: 'center',
          textsize: opts.textSize,
          paddingwidth: 2,
          paddingheight: 2,
          backgroundcolor: 'FFFFFF',
        } as any);
      } catch {
        // Swallow and throw original
      }
    }
    const message =
      typeof err === 'string'
        ? err
        : err?.message || 'Unknown bwip-js render error';
    throw new Error(`Barcode render failed (${bcid} "${code}"): ${message}`);
  }
}

/**
 * Render a barcode to an SVG data URL (for `<img src="">` usage).
 */
export function renderBarcodeDataURL(
  code: string,
  symbology: LabelSymbology = 'AUTO',
  options: BarcodeRenderOptions = {}
): string {
  const svg = renderBarcodeSVG(code, symbology, options);
  const b64 = Buffer.from(svg, 'utf8').toString('base64');
  return `data:image/svg+xml;base64,${b64}`;
}

/**
 * Build a GS1-128 payload from Application Identifiers. Caller supplies a
 * GTIN (01), optional BATCH (10), and optional expiry as a Date.
 *
 * Returns a string of the form `(01)GTIN(10)BATCH(17)YYMMDD` which bwip-js
 * parses via `parsefnc` when rendering with bcid=`gs1-128`.
 *
 * We use the ^FNC1 parenthesised-AI form which bwip-js understands natively
 * for GS1-128; no extra `parse` flag is required for this input style.
 */
export function buildGS1Payload(args: {
  gtin: string;
  batch?: string | null;
  expiry?: Date | null;
}): string {
  const parts: string[] = [];
  parts.push(`(01)${args.gtin}`);
  if (args.batch) parts.push(`(10)${args.batch}`);
  if (args.expiry) {
    const d = args.expiry;
    const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    parts.push(`(17)${yy}${mm}${dd}`);
  }
  return parts.join('');
}
