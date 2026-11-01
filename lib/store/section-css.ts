import { sanitizeCustomCss } from './store-theme';
import { SECTION_CSS_MAX } from './studio-sections';

export { SECTION_CSS_MAX, sanitizeCssClass } from './studio-sections';

/** DOM id of a Studio section's wrapper. The prefix keeps it a valid CSS id whatever the section id is. */
export function sectionDomId(sectionId: string): string {
  return `section-${sectionId}`;
}

/** Index of the `}` that closes the block opened at `open`, skipping quoted strings; -1 when unbalanced. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const close = css.indexOf(c, i + 1);
      if (close < 0) return -1;
      i = close;
    } else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Next `{`, `;` or `}` outside quotes. */
function nextStop(css: string, from: number): number {
  for (let i = from; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const close = css.indexOf(c, i + 1);
      if (close < 0) return -1;
      i = close;
    } else if (c === '{' || c === ';' || c === '}') return i;
  }
  return -1;
}

/** Splits a selector list on commas that are not inside (…) or […]. */
function splitSelectors(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < prelude.length; i++) {
    const c = prelude[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(prelude.slice(start, i));
      start = i + 1;
    }
  }
  out.push(prelude.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

const GROUP_AT_RULES = new Set(['media', 'supports', 'container']);
const RAW_AT_RULES = new Set(['keyframes', '-webkit-keyframes']);

/**
 * Rebuilds merchant CSS rule by rule, passing every selector through `mapSelector`.
 * The output is always brace-balanced, so nothing can close the wrapper it is placed in.
 * @media/@supports/@container recurse, @keyframes are copied as-is, every other at-rule is dropped.
 */
function rewriteRules(css: string, mapSelector: (selector: string) => string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const stop = nextStop(css, i);
    if (stop < 0) break;
    if (css[stop] !== '{') {
      // A stray declaration, `@charset …;` or an extra `}`: skip it.
      i = stop + 1;
      continue;
    }
    const end = blockEnd(css, stop);
    if (end < 0) break;
    const prelude = css.slice(i, stop).trim();
    const body = css.slice(stop + 1, end);
    i = end + 1;
    if (!prelude) continue;
    if (prelude.startsWith('@')) {
      const name = (/^@([\w-]+)/.exec(prelude)?.[1] ?? '').toLowerCase();
      if (GROUP_AT_RULES.has(name)) {
        const inner = rewriteRules(body, mapSelector);
        if (inner) out += `${prelude}{${inner}}`;
      } else if (RAW_AT_RULES.has(name)) {
        out += `${prelude}{${body}}`;
      }
      continue;
    }
    const selectors = splitSelectors(prelude).map(mapSelector).filter(Boolean);
    if (selectors.length) out += `${selectors.join(',')}{${body.trim()}}`;
  }
  return out;
}

function prepare(css: string, max: number): string {
  return sanitizeCustomCss(css.slice(0, max))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // `<` has no use in CSS outside strings and could start `</style>` inside the tag.
    .replace(/</g, '');
}

/** Selector that refers to the page or store root rather than something inside it. */
const ROOT_SELECTOR = /^(?::root|html|body|\.st-root|:scope|&)(?=$|[\s>+~.:#[])/;

/**
 * Scopes one section's CSS to its wrapper: `h2` becomes `#section-x h2`, and `&` or `:scope`
 * means the section box itself. The id selector also outranks the theme's own rules.
 */
export function scopeSectionCss(css: string | undefined, sectionId: string): string {
  if (!css || !css.trim()) return '';
  const scope = `#${sectionDomId(sectionId)}`;
  return rewriteRules(prepare(css, SECTION_CSS_MAX), (sel) => {
    if (ROOT_SELECTOR.test(sel)) return sel.replace(ROOT_SELECTOR, scope);
    return `${scope} ${sel}`;
  });
}

/**
 * Store-wide CSS for the Studio editor preview: confined to `root` with @scope so it can't restyle
 * the editor around it, while selectors keep the same specificity they have on the live store.
 */
export function previewStoreCss(css: string | undefined, root: string): string {
  if (!css || !css.trim()) return '';
  const inner = rewriteRules(prepare(css, 8000), (sel) =>
    ROOT_SELECTOR.test(sel) ? sel.replace(ROOT_SELECTOR, ':scope') : sel,
  );
  return inner ? `@scope (${root}){${inner}}` : '';
}
