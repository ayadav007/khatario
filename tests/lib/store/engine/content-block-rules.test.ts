import { readFileSync } from 'fs';
import { join } from 'path';
import { CONTENT_BLOCK_RULES } from '@/components/store/engine/content-block-rules';

// There is no visual harness for the engine stylesheet, so these pin the rules whose absence or drift was a real regression.

const ruleBody = (selector: string): string => {
  const rule = CONTENT_BLOCK_RULES.split('}').find((r) => r.split('{')[0].trim() === selector) ?? '';
  return rule.slice(rule.indexOf('{') + 1);
};

describe('content block rules', () => {
  it('every rule is scoped under the engine root', () => {
    const selectors = CONTENT_BLOCK_RULES.split('}')
      .map((r) => r.split('{')[0].trim())
      .filter(Boolean);
    for (const sel of selectors) expect(sel.startsWith('.st-root.eng-root') || sel.startsWith('@container')).toBe(true);
  });

  it("Image with text keeps the old hero heading size, line height and top margin for the medium heading", () => {
    expect(ruleBody('.st-root.eng-root .hero .heroCopy .eng-cb-size-medium')).toBe('font-size:clamp(24px,5cqi,40px);line-height:1.1');
    expect(ruleBody('.st-root.eng-root .hero .heroCopy .eng-cb-heading')).toContain('margin-top:12px');
  });

  it('Rich text headings stay at the old .rich h2 size', () => {
    expect(ruleBody('.st-root.eng-root .eng-cb-size-medium')).toBe('font-size:clamp(22px,3.4cqi,32px)');
  });

  it('centred Image with text centres its column items and stretches block text', () => {
    expect(ruleBody('.st-root.eng-root .eng-iwt-center .heroCopy')).toContain('align-items:center');
    expect(ruleBody('.st-root.eng-root .eng-iwt-center .heroCopy :is(.eng-cb-text,.eng-cb-quote)')).toContain('align-self:stretch');
  });

  it('a text block keeps the old 20px gap before what follows, and none when it is last', () => {
    expect(ruleBody('.st-root.eng-root .eng-cb-text')).toBe('margin-bottom:20px');
    // Same specificity, so the :last-child rule must come after it to win.
    const selectors = CONTENT_BLOCK_RULES.split('}').map((r) => r.split('{')[0].trim());
    expect(selectors.indexOf('.st-root.eng-root .eng-cb-text')).toBeGreaterThan(selectors.indexOf('.st-root.eng-root .eng-cb'));
    expect(selectors.indexOf('.st-root.eng-root .eng-cb:last-child')).toBeGreaterThan(selectors.indexOf('.st-root.eng-root .eng-cb-text'));
    expect(ruleBody('.st-root.eng-root .eng-cb:last-child')).toBe('margin-bottom:0');
  });

  it('the last paragraph of a text block adds no margin of its own', () => {
    expect(ruleBody('.st-root.eng-root .eng-cb-text p:last-child')).toContain('margin-bottom:0');
  });
});

describe('grocery.css hero heading', () => {
  const css = readFileSync(join(process.cwd(), 'components/store/engine/presets/grocery.css'), 'utf8');
  it('styles the block heading, not the removed .eng-heroTitle', () => {
    expect(css).not.toContain('.eng-heroTitle');
    expect(css).toContain('.eng-cb-heading.eng-cb-size-medium');
  });
});
