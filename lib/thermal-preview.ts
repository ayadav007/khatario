const THERMAL_PREVIEW_STYLE_ID = 'khatario-thermal-screen-preview';

export function isThermalTemplateId(templateId: string | null | undefined): boolean {
  return templateId === 'thermal_58mm' || templateId === 'thermal_80mm';
}

export function thermalPaperWidthMm(templateId: string): 58 | 80 {
  return templateId === 'thermal_58mm' ? 58 : 80;
}

/** CSS so screen preview matches roll width (not A4 canvas). */
export function getThermalScreenPreviewCss(templateId: string): string {
  const widthMm = thermalPaperWidthMm(templateId);
  const bodyClass =
    templateId === 'thermal_58mm' ? 'format-thermal-58mm' : 'format-thermal-80mm';

  return `
@media screen {
  html {
    background: #e5e7eb !important;
    height: auto !important;
    min-height: 100% !important;
  }
  body.${bodyClass},
  body.thermal-mode {
    width: ${widthMm}mm !important;
    max-width: ${widthMm}mm !important;
    min-width: ${widthMm}mm !important;
    margin: 12px auto 20px auto !important;
    background: #ffffff !important;
    box-shadow: 0 2px 16px rgba(0, 0, 0, 0.12);
    height: auto !important;
    min-height: 0 !important;
    box-sizing: border-box !important;
  }
}
`.trim();
}

export function injectThermalScreenPreviewCss(html: string, templateId: string): string {
  if (!isThermalTemplateId(templateId)) return html;

  const css = getThermalScreenPreviewCss(templateId);
  const block = `<style id="${THERMAL_PREVIEW_STYLE_ID}">\n${css}\n</style>`;

  let out = html.replace(
    new RegExp(
      `<style\\s+id=["']${THERMAL_PREVIEW_STYLE_ID}["'][^>]*>[\\s\\S]*?<\\/style>`,
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

/** Tailwind-friendly width class for preview iframes */
export function thermalPreviewIframeWidthClass(templateId: string | null | undefined): string {
  if (templateId === 'thermal_58mm') return 'w-[58mm] max-w-[95vw]';
  if (templateId === 'thermal_80mm') return 'w-[80mm] max-w-[95vw]';
  return 'w-full';
}
