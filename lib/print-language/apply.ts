import Handlebars from 'handlebars';
import type { DocumentLanguage } from './codes';
import { normalizeDocumentLanguage, printFontStack } from './codes';
import { printLabelMatches, translateLabelKey, translatePhrase } from './labels';

const SYSTEM_ROW_LABELS = new Set([
  'Opening Stock',
  'Add: Purchases (net of returns)',
  'Less: Closing Stock',
]);

let helperRegistered = false;

export function registerPrintLanguageHelper(): void {
  if (helperRegistered) return;
  helperRegistered = true;
  Handlebars.registerHelper('t', function (this: unknown, key: unknown, options: Handlebars.HelperOptions) {
    const root = (options?.data?.root || this || {}) as { document_language?: unknown };
    return translateLabelKey(normalizeDocumentLanguage(root.document_language), String(key ?? ''));
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace known English headings with {{t "key"}} outside tags, styles, and mustaches. */
export function embedPrintPhrases(source: string): string {
  const splitter = /(<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|\{\{[\s\S]*?\}\}|<[^>]+>)/gi;
  const parts = source.split(splitter);
  return parts.map((part) => {
    if (!part || part.startsWith('<') || part.startsWith('{{')) return part;
    let text = part;
    for (const { phrase, key } of printLabelMatches()) {
      const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(phrase)}(?![A-Za-z0-9])`, 'g');
      text = text.replace(pattern, `{{t "${key}"}}`);
    }
    return text;
  }).join('');
}

export function localizePrintChrome(data: Record<string, any> | null | undefined, language: DocumentLanguage): void {
  if (!data || language === 'en') return;
  const sections = [
    data.data?.asset_sections,
    data.data?.liability_sections,
  ];
  for (const list of sections) {
    if (!Array.isArray(list)) continue;
    for (const section of list) {
      if (section && typeof section.title === 'string') {
        section.title = translatePhrase(language, section.title);
      }
    }
  }
  const blocks = data.data?.blocks;
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (!block) continue;
    if (typeof block.label === 'string') block.label = translatePhrase(language, block.label);
    if (typeof block.total_label === 'string') {
      const prefix = 'Total for ';
      if (block.total_label.startsWith(prefix)) {
        const rest = block.total_label.slice(prefix.length);
        block.total_label = `${translatePhrase(language, 'Total for')} ${translatePhrase(language, rest)}`;
      } else {
        block.total_label = translatePhrase(language, block.total_label);
      }
    }
    if (!Array.isArray(block.rows)) continue;
    for (const row of block.rows) {
      if (row && SYSTEM_ROW_LABELS.has(row.label)) {
        row.label = translatePhrase(language, row.label);
      }
    }
  }
}

export function injectPrintLanguage(html: string, language: DocumentLanguage): string {
  if (language === 'en') return html;
  const lang = language === 'hinglish' ? 'hi-Latn' : language;
  let out = html.replace(/<html\b([^>]*)>/i, (_match, attrs: string) => {
    if (/\blang\s*=/.test(attrs)) {
      return `<html${attrs.replace(/\blang\s*=\s*(["']).*?\1/i, `lang="${lang}"`)}>`;
    }
    return `<html lang="${lang}"${attrs}>`;
  });
  const stack = printFontStack(language);
  if (!stack || !/<\/head>/i.test(out)) return out;
  const css = `<style id="khatario-print-lang">body, body * { font-family: ${stack} !important; }</style>`;
  return out.replace(/<\/head>/i, `${css}\n</head>`);
}

export function renderLocalizedPrintHtml(
  source: string,
  data: Record<string, any>,
  language: unknown,
): string {
  registerPrintLanguageHelper();
  const lang = normalizeDocumentLanguage(language ?? data?.document_language ?? data?.settings?.document_language);
  if (lang === 'en') {
    return Handlebars.compile(source)(data);
  }
  localizePrintChrome(data, lang);
  const prepared = embedPrintPhrases(source);
  const template = Handlebars.compile(prepared);
  const html = template({ ...data, document_language: lang });
  return injectPrintLanguage(html, lang);
}
