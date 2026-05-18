/**
 * Best-effort HTML/CSS adjustments for 58mm / 80mm thermal PDF output.
 * Safe: only adds a class, optional hidden columns, and a dedicated style block.
 */

import { detectColumns, generateColumnCSS } from './column-detector';

const STYLE_ID = 'khatario-thermal-optimize';

const THERMAL_LAYER_CSS = `
@page {
  margin: 0;
}
body.thermal-mode {
  font-size: 10px !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* Hide optional wide columns if templates use these hooks */
.thermal-mode .description,
.thermal-mode .extra-info,
.thermal-mode .notes {
  display: none !important;
}

/* Controlled reset — compact without stripping tables, images, or headers */
body.thermal-mode,
body.thermal-mode p,
body.thermal-mode div,
body.thermal-mode section {
  margin: 0 !important;
  padding: 0 !important;
}

/* Minimal inset: prefer wrapper when templates use it */
body.thermal-mode .pdf-container {
  padding: 2px !important;
}

body.thermal-mode:not(:has(.pdf-container)) {
  padding: 2px !important;
}

body.thermal-mode table {
  border-collapse: collapse;
}

body.thermal-mode td,
body.thermal-mode th {
  padding: 2px 0 !important;
}

body.thermal-mode td {
  word-break: break-word;
  overflow-wrap: anywhere;
}

body.thermal-mode .total,
body.thermal-mode .grand-total {
  text-align: right !important;
  font-weight: bold !important;
}

body.thermal-mode img {
  display: block;
  margin: 0 auto 4px auto;
}
`.trim();

function buildThermalLayerCss(html: string): string {
  try {
    const { columnTypes } = detectColumns(html);
    if (columnTypes.length === 0) return THERMAL_LAYER_CSS;

    const columnCSS = generateColumnCSS(columnTypes);
    if (!columnCSS) return THERMAL_LAYER_CSS;

    return `${THERMAL_LAYER_CSS}

/* Smart column layout (first table, first row) */
body.thermal-mode table {
  table-layout: fixed;
  width: 100%;
}

${columnCSS}`;
  } catch {
    return THERMAL_LAYER_CSS;
  }
}

function mergeThermalModeBodyClass(html: string): string {
  return html.replace(/<body\b[^>]*>/i, (openTag) => {
    if (/\bthermal-mode\b/.test(openTag)) return openTag;
    if (/\bclass\s*=/i.test(openTag)) {
      return openTag.replace(/\bclass\s*=\s*(["'])([\s\S]*?)\1/i, (_m, quote: string, existing: string) => {
        const merged = [existing.trim(), 'thermal-mode'].filter(Boolean).join(' ');
        return `class=${quote}${merged}${quote}`;
      });
    }
    return openTag.replace(/<body\b/i, '<body class="thermal-mode"');
  });
}

/**
 * Injects thermal optimization styles and ensures `thermal-mode` on `<body>`.
 */
export function optimizeForThermal(html: string): string {
  let out = html.replace(
    new RegExp(`<style\\s+id=["']${STYLE_ID}["'][^>]*>[\\s\\S]*?</style>`, 'gi'),
    ''
  );

  const layerCss = buildThermalLayerCss(html);
  const block = `<style id="${STYLE_ID}">\n${layerCss}\n</style>`;
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${block}\n</head>`);
  } else {
    out = `<head>${block}</head>${out}`;
  }

  out = mergeThermalModeBodyClass(out);
  return out;
}
