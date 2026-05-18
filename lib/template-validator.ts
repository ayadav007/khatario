/**
 * Safe, non-blocking validation + sanitization for invoice print HTML before PDF/preview.
 * Does not throw; conflicts with system print CSS are reduced by stripping template @page rules.
 */

export interface TemplateValidationResult {
  html: string;
  warnings: string[];
}

/**
 * Removes `@page { ... }` blocks including nested braces (e.g. margin boxes).
 * Does not strip `@page` inside HTML comments or strings (acceptable tradeoff for templates).
 */
function stripAtPageRules(html: string): string {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const idx = html.indexOf('@page', i);
    if (idx === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, idx);
    let pos = idx + 5;
    while (pos < html.length && /\s/.test(html[pos])) pos++;
    while (pos < html.length && html[pos] !== '{') pos++;
    if (pos >= html.length || html[pos] !== '{') {
      out += html[idx];
      i = idx + 1;
      continue;
    }
    let depth = 0;
    let end = pos;
    for (; end < html.length; end++) {
      const ch = html[end];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end++;
          break;
        }
      }
    }
    i = end;
  }
  return out;
}

/**
 * Validates template HTML and strips rules that conflict with centralized print config.
 */
export function validateAndSanitizeTemplate(html: string): TemplateValidationResult {
  const warnings: string[] = [];

  if (!/<body[\s>]/i.test(html)) {
    warnings.push('Missing <body> tag');
  }

  if (!/<table[\s>]/i.test(html)) {
    warnings.push('No table found in template');
  }

  if (!/@media\s+print\b/i.test(html)) {
    warnings.push('No @media print block found (layout may differ between screen and PDF)');
  }

  if (/position\s*:\s*(absolute|fixed)/gi.test(html)) {
    warnings.push('Template uses absolute/fixed positioning (may break in PDF)');
  }

  if (/width\s*:\s*\d{3,4}px/gi.test(html)) {
    warnings.push('Template uses large fixed pixel widths (may overflow or clip in PDF)');
  }

  const sanitized = stripAtPageRules(html);

  return { html: sanitized, warnings };
}
