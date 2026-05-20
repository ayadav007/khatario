/**
 * Screen (iframe) preview for template customize — mirrors print/PDF page size and margins.
 */

import type { ResolvedPrintConfig } from '@/lib/print-config';
import { resolvePrintConfig } from '@/lib/print-config';
import {
  injectThermalScreenPreviewCss,
  isThermalTemplateId,
  thermalPaperWidthMm,
} from '@/lib/thermal-preview';

const SCREEN_PREVIEW_STYLE_ID = 'khatario-template-screen-preview';

const PAPER_MM: Record<string, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  LETTER: { w: 215.9, h: 279.4 },
  LEGAL: { w: 215.9, h: 355.6 },
  A6: { w: 105, h: 148 },
  A3: { w: 297, h: 420 },
};

export function mmToPreviewPx(mm: number): number {
  return Math.round((mm * 96) / 25.4);
}

export type TemplatePreviewSpec = {
  widthPx: number;
  heightPx: number;
  pageLabel: string;
  isThermal: boolean;
};

function normalizePageKey(raw: unknown): string {
  return String(raw ?? 'A4')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/** Logical page size for the preview iframe (portrait or landscape). */
export function getTemplatePreviewSpec(
  templateId: string,
  settings: Record<string, unknown>
): TemplatePreviewSpec {
  if (isThermalTemplateId(templateId)) {
    const widthMm = thermalPaperWidthMm(templateId);
    const widthPx = mmToPreviewPx(widthMm);
    return {
      widthPx,
      heightPx: Math.max(600, Math.round(widthPx * 2.8)),
      pageLabel: templateId === 'thermal_58mm' ? '58mm thermal' : '80mm thermal',
      isThermal: true,
    };
  }

  const pageKey = normalizePageKey(settings.page_size);
  const landscape = (settings.orientation || 'portrait') === 'landscape';
  const sheet = PAPER_MM[pageKey] || PAPER_MM.A4;
  const widthMm = landscape ? sheet.h : sheet.w;
  const heightMm = landscape ? sheet.w : sheet.h;

  return {
    widthPx: mmToPreviewPx(widthMm),
    heightPx: mmToPreviewPx(heightMm),
    pageLabel: landscape ? `${pageKey} landscape` : pageKey,
    isThermal: false,
  };
}

function paperWidthMmFromConfig(config: ResolvedPrintConfig): number {
  if (config.format === 'THERMAL_58MM') return 58;
  if (config.format === 'THERMAL_80MM') return 80;
  const desc = config.cssPageDescriptor || 'A4 portrait';
  const parts = desc.split(/\s+/);
  const name = (parts[0] || 'A4').toUpperCase();
  const landscape = parts[1] === 'landscape';
  const sheet = PAPER_MM[name] || PAPER_MM.A4;
  return landscape ? sheet.h : sheet.w;
}

/** Screen-only CSS: paper width + margins so customize preview matches PDF. */
export function injectTemplateScreenPreviewCss(
  html: string,
  templateId: string,
  settings: Record<string, unknown>
): string {
  if (isThermalTemplateId(templateId)) {
    return injectThermalScreenPreviewCss(html, templateId);
  }

  const config = resolvePrintConfig(templateId, settings);
  const { marginsMm } = config;
  const widthMm = paperWidthMmFromConfig(config);
  const bodyClass = config.bodyClasses.filter((c) => c.startsWith('format-')).join(' ') || 'format-A4';

  const css = `
@media screen {
  html {
    background: #e5e7eb !important;
    height: auto !important;
    min-height: 100% !important;
    margin: 0 !important;
    overflow: hidden !important;
  }
  body.print-root.${bodyClass},
  body.print-root {
    box-sizing: border-box !important;
    width: ${widthMm}mm !important;
    max-width: ${widthMm}mm !important;
    min-width: ${widthMm}mm !important;
    margin: 16px auto 24px auto !important;
    padding: ${marginsMm.top}mm ${marginsMm.right}mm ${marginsMm.bottom}mm ${marginsMm.left}mm !important;
    background: #ffffff !important;
    box-shadow: 0 2px 16px rgba(0, 0, 0, 0.12);
    height: auto !important;
    min-height: 0 !important;
    overflow: hidden !important;
  }
  body.print-root .invoice-container,
  body.print-root .container {
    max-width: 100% !important;
    width: 100% !important;
    box-sizing: border-box !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
    overflow-x: hidden !important;
  }
  body.print-root table {
    max-width: 100% !important;
  }
}
`.trim();

  const block = `<style id="${SCREEN_PREVIEW_STYLE_ID}">\n${css}\n</style>`;
  let out = html.replace(
    new RegExp(
      `<style\\s+id=["']${SCREEN_PREVIEW_STYLE_ID}["'][^>]*>[\\s\\S]*?<\\/style>`,
      'gi'
    ),
    ''
  );

  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${block}\n</head>`);
  } else {
    out = `<!DOCTYPE html><html><head>${block}</head><body>${out}</body></html>`;
  }

  return out;
}
