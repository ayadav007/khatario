import { readFileSync } from 'fs';
import { join } from 'path';

const PRESETS = ['quick', 'grocery', 'khatario'] as const;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface Rule {
  prelude: string;
  body: string;
}

/** Top-level rules and at-rules of a CSS text: `prelude { body }`, braces matched. */
function splitRules(css: string): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) {
      if (css.slice(i).trim()) throw new Error(`trailing text: ${css.slice(i).trim().slice(0, 60)}`);
      break;
    }
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    if (depth !== 0) throw new Error('unbalanced braces');
    const prelude = css.slice(i, open).trim();
    if (prelude.includes('}') || prelude.includes(';')) throw new Error(`bad prelude: ${prelude.slice(0, 60)}`);
    out.push({ prelude, body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

/** Splits a selector list at top-level commas (not inside :is()/:not() parentheses). */
function splitSelectors(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let k = 0; k < prelude.length; k++) {
    const c = prelude[k];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(prelude.slice(start, k).trim());
      start = k + 1;
    }
  }
  out.push(prelude.slice(start).trim());
  return out;
}

function collect(css: string, name: string): { selectors: string[]; keyframes: string[] } {
  const selectors: string[] = [];
  const keyframes: string[] = [];
  for (const rule of splitRules(css)) {
    if (rule.prelude.startsWith('@')) {
      const m = /^@([a-z-]+)\s*(.*)$/is.exec(rule.prelude);
      const at = m?.[1].toLowerCase() ?? '';
      if (at === 'keyframes' || at === '-webkit-keyframes') {
        keyframes.push((m?.[2] ?? '').trim());
        continue;
      }
      if (at === 'media' || at === 'container' || at === 'supports') {
        const inner = collect(rule.body, name);
        selectors.push(...inner.selectors);
        keyframes.push(...inner.keyframes);
        continue;
      }
      throw new Error(`unexpected at-rule @${at} in ${name}.css`);
    }
    selectors.push(...splitSelectors(rule.prelude));
  }
  return { selectors, keyframes };
}

describe.each(PRESETS)('%s.css preset layer', (name) => {
  const raw = readFileSync(join(process.cwd(), 'components/store/engine/presets', `${name}.css`), 'utf8');
  const css = stripComments(raw);
  const { selectors, keyframes } = collect(css, name);
  const prefix = `.st-root.eng-root.eng-preset-${name}`;

  it('has rules', () => {
    expect(selectors.length).toBeGreaterThan(0);
  });

  it('scopes every selector to its preset', () => {
    const bad = selectors.filter((s) => !s.startsWith(prefix) || /^[a-z0-9_-]/i.test(s.slice(prefix.length)));
    expect(bad).toEqual([]);
  });

  it('names its keyframes eng-<preset>-', () => {
    for (const k of keyframes) expect(k.startsWith(`eng-${name}-`)).toBe(true);
  });

  it('loads nothing and runs nothing', () => {
    expect(css.toLowerCase()).not.toContain('@import');
    expect(css.toLowerCase()).not.toContain('url(');
    expect(css.toLowerCase()).not.toContain('expression(');
  });
});
