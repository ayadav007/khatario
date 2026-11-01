import { readFileSync } from 'fs';
import { join } from 'path';

// Theme's own must look exactly as today: every product-card.css rule needs `pc-on` on the card root (only a card design
// adds it) and sits under the engine root.
const css = readFileSync(join(__dirname, '../../../../components/store/engine/product-card.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every style rule's selector list, at-rule wrappers opened. */
function selectorLists(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) {
      expect(text.slice(i).trim()).toBe('');
      break;
    }
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    expect(depth).toBe(0);
    const prelude = text.slice(i, open).trim();
    const body = text.slice(open + 1, j - 1);
    if (prelude.startsWith('@')) out.push(...selectorLists(body));
    else out.push(prelude);
    i = j;
  }
  return out;
}

/** Split a selector list on top-level commas (not those inside :is()). */
function selectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

describe('product-card.css', () => {
  const all = selectorLists(css).flatMap(selectors);

  it('has rules', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it('scopes every selector to the engine root and a card carrying pc-on (written three times to out-rank the presets)', () => {
    for (const sel of all) {
      expect(sel.startsWith('.st-root.eng-root ')).toBe(true);
      expect(sel).toMatch(/\.product\.pc-on\.pc-on\.pc-on(?![\w-])/);
    }
  });
});
