/**
 * Centralized print/PDF configuration for Puppeteer + invoice templates.
 *
 * Separates:
 * - System print rules (injected CSS, body classes, Puppeteer geometry)
 * - User settings (margins, page_size, orientation from TemplateSettings)
 * - Template styling (existing Handlebars templates unchanged)
 */

import type { TemplateSettings } from '@/types/template';

/** Canonical formats supported by the PDF pipeline */
export type PrintFormat =
  | 'A4'
  | 'A5'
  | 'A4_LANDSCAPE'
  | 'THERMAL_80MM'
  | 'THERMAL_58MM';

const MARGIN_MM_MIN = 3;
const MARGIN_MM_MAX = 25;

export interface ResolvedPrintMarginsMm {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ResolvedPuppeteerPdfOptions {
  printBackground: boolean;
  /** ISO-like paper format for standard invoices */
  format?: 'A3' | 'A4' | 'A5' | 'A6' | 'Legal' | 'Letter' | 'Tabloid';
  landscape?: boolean;
  /** Continuous roll / thermal */
  width?: string;
  height?: string;
  margin: {
    top: string;
    right: string;
    bottom: string;
    left: string;
  };
  /**
   * Prefer CSS @page size when non-thermal. Thermal uses explicit mm width from Puppeteer.
   */
  preferCSSPageSize: boolean;
}

export interface ResolvedPrintConfig {
  format: PrintFormat;
  /** Classes merged onto `<body>` — e.g. `print-root format-A4` */
  bodyClasses: string[];
  /** True when user chose A5 + landscape (CSS + Puppeteer landscape flag) */
  isA5Landscape: boolean;
  marginsMm: ResolvedPrintMarginsMm;
  puppeteer: ResolvedPuppeteerPdfOptions;
  /**
   * Chromium @page size descriptor (e.g. "A4 portrait", "Letter landscape").
   * When set, injected CSS uses this for @page { size: ... } with margin: 0 (Puppeteer supplies printable margins).
   */
  cssPageDescriptor?: string;
}

function clampMarginMm(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MARGIN_MM_MAX, Math.max(MARGIN_MM_MIN, n));
}

function normalizePageSizeKey(raw: unknown): string {
  return String(raw ?? 'A4')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function mapPageSizeToPuppeteerFormat(pageSize: string): NonNullable<ResolvedPuppeteerPdfOptions['format']> {
  switch (pageSize) {
    case 'A5':
      return 'A5';
    case 'A6':
      return 'A6';
    case 'LEGAL':
      return 'Legal';
    case 'LETTER':
      return 'Letter';
    case 'TABLOID':
      return 'Tabloid';
    case 'A3':
      return 'A3';
    case 'A4':
    default:
      return 'A4';
  }
}

/** Paper name for CSS `size:` (Chromium). Unknown sizes fall back to A4. */
function cssPaperName(pageSize: string): string {
  const u = normalizePageSizeKey(pageSize);
  switch (u) {
    case 'A3':
      return 'A3';
    case 'A5':
      return 'A5';
    case 'A6':
      return 'A6';
    case 'LETTER':
      return 'Letter';
    case 'LEGAL':
      return 'Legal';
    case 'TABLOID':
      return 'Tabloid';
    case 'A4':
    default:
      return 'A4';
  }
}

/** Maps stored page_size + orientation to a CSS @page size descriptor (Chromium). */
function cssPageSizeDescriptor(pageSize: string, orientation: 'portrait' | 'landscape'): string {
  const ori = orientation === 'landscape' ? 'landscape' : 'portrait';
  return `${cssPaperName(pageSize)} ${ori}`;
}

/**
 * Derives body/CSS/Puppeteer options from template id + merged template settings.
 * Template id wins for thermal (locks paper width).
 */
export function resolvePrintConfig(
  templateId: string,
  settings: Partial<TemplateSettings> | Record<string, unknown>
): ResolvedPrintConfig {
  const s = settings as Partial<TemplateSettings>;

  if (templateId === 'thermal_80mm') {
    return {
      format: 'THERMAL_80MM',
      bodyClasses: ['print-root', 'format-thermal-80mm'],
      isA5Landscape: false,
      marginsMm: { top: 0, bottom: 0, left: 0, right: 0 },
      cssPageDescriptor: undefined,
      puppeteer: {
        printBackground: true,
        width: '80mm',
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
        preferCSSPageSize: false,
      },
    };
  }

  if (templateId === 'thermal_58mm') {
    return {
      format: 'THERMAL_58MM',
      bodyClasses: ['print-root', 'format-thermal-58mm'],
      isA5Landscape: false,
      marginsMm: { top: 0, bottom: 0, left: 0, right: 0 },
      cssPageDescriptor: undefined,
      puppeteer: {
        printBackground: true,
        width: '58mm',
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
        preferCSSPageSize: false,
      },
    };
  }

  const pageSize = normalizePageSizeKey(s.page_size);
  const orientation = (s.orientation || 'portrait') === 'landscape' ? 'landscape' : 'portrait';

  const mt = clampMarginMm(s.margin_top, 10);
  const mb = clampMarginMm(s.margin_bottom, 10);
  const ml = clampMarginMm(s.margin_left, 10);
  const mr = clampMarginMm(s.margin_right, 10);

  const marginCss = {
    top: `${mt}mm`,
    bottom: `${mb}mm`,
    left: `${ml}mm`,
    right: `${mr}mm`,
  };

  const puppeteerFormat = mapPageSizeToPuppeteerFormat(pageSize);

  // --- Standard paper path ---
  if (pageSize === 'A4' && orientation === 'landscape') {
    return {
      format: 'A4_LANDSCAPE',
      bodyClasses: ['print-root', 'format-A4', 'format-A4-landscape', 'orientation-landscape'],
      isA5Landscape: false,
      marginsMm: { top: mt, bottom: mb, left: ml, right: mr },
      cssPageDescriptor: cssPageSizeDescriptor('A4', 'landscape'),
      puppeteer: {
        printBackground: true,
        format: 'A4',
        landscape: true,
        margin: marginCss,
        preferCSSPageSize: true,
      },
    };
  }

  if (pageSize === 'A5' && orientation === 'landscape') {
    return {
      format: 'A5',
      bodyClasses: ['print-root', 'format-A5', 'format-A5-landscape', 'orientation-landscape'],
      isA5Landscape: true,
      marginsMm: { top: mt, bottom: mb, left: ml, right: mr },
      cssPageDescriptor: cssPageSizeDescriptor('A5', 'landscape'),
      puppeteer: {
        printBackground: true,
        format: 'A5',
        landscape: true,
        margin: marginCss,
        preferCSSPageSize: true,
      },
    };
  }

  // Portrait (and default): derive PrintFormat label for CSS class
  let format: PrintFormat = 'A4';
  const body: string[] = ['print-root', 'orientation-portrait'];
  if (pageSize === 'A5') {
    format = 'A5';
    body.push('format-A5');
  } else {
    // Treat LETTER/LEGAL/A6/A3/unknown as slug-based class for hooks, default "sheet" to A4 driver
    format = 'A4';
    body.push('format-A4');
    if (pageSize && pageSize !== 'A4') {
      body.push(`format-page-${pageSize.toLowerCase()}`);
    }
  }

  return {
    format,
    bodyClasses: body,
    isA5Landscape: false,
    marginsMm: { top: mt, bottom: mb, left: ml, right: mr },
    cssPageDescriptor: cssPageSizeDescriptor(pageSize, 'portrait'),
    puppeteer: {
      printBackground: true,
      format: puppeteerFormat,
      landscape: false,
      margin: marginCss,
      preferCSSPageSize: true,
    },
  };
}

/** Global print baseline injected on every PDF (system-controlled). */
export function getGlobalPrintCSS(): string {
  return `
@media print {
  html, body {
    margin: 0 !important;
    padding: 0 !important;
  }

  * {
    box-sizing: border-box;
  }

  table {
    page-break-inside: auto;
  }

  tr {
    page-break-inside: avoid;
    break-inside: avoid-page;
  }

  .no-break {
    page-break-inside: avoid;
    break-inside: avoid-page;
  }
}
`.trim();
}

/**
 * Page size/orientation hints for @page (works with preferCSSPageSize + Puppeteer margins).
 */
export function getPageCSS(config: ResolvedPrintConfig): string {
  if (config.format === 'THERMAL_80MM') {
    return `
@page {
  margin: 0;
  size: 80mm auto;
}
body.format-thermal-80mm {
  width: 100%;
}
`.trim();
  }
  if (config.format === 'THERMAL_58MM') {
    return `
@page {
  margin: 0;
  size: 58mm auto;
}
body.format-thermal-58mm {
  width: 100%;
}
`.trim();
  }

  const desc = config.cssPageDescriptor || 'A4 portrait';
  return `
@page {
  size: ${desc};
  margin: 0;
}
`.trim();
}

export function getInjectedPrintStylesheet(config: ResolvedPrintConfig): string {
  return [getGlobalPrintCSS(), getPageCSS(config)].join('\n\n');
}

/**
 * Injects system print CSS before </head> and merges classes on <body>.
 * Idempotent: replaces previous `#khatario-print-system` block if present.
 */
export function injectPrintHtmlEnhancements(html: string, config: ResolvedPrintConfig): string {
  const css = getInjectedPrintStylesheet(config);
  const styleBlock = `<style id="khatario-print-system">\n${css}\n</style>`;

  let out = html.replace(/<style\s+id=["']khatario-print-system["'][^>]*>[\s\S]*?<\/style>/gi, '');

  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${styleBlock}\n</head>`);
  } else {
    out = `<!DOCTYPE html><html><head>${styleBlock}</head><body>${out}</body></html>`;
  }

  const classAttr = config.bodyClasses.join(' ');
  out = out.replace(/<body\b[^>]*>/i, (openTag) => {
    if (/\bclass\s*=/i.test(openTag)) {
      return openTag.replace(/\bclass\s*=\s*(["'])([\s\S]*?)\1/i, (_m, quote: string, existing: string) => {
        const merged = [existing.trim(), classAttr].filter(Boolean).join(' ');
        return `class=${quote}${merged}${quote}`;
      });
    }
    return openTag.replace('<body', `<body class="${classAttr}"`);
  });

  return out;
}
