import { PREMIUM_SECTION_RULES } from '@/components/store/engine/premium-section-rules';

const ruleBody = (selector: string): string => {
  const rule = PREMIUM_SECTION_RULES.split('}').find((r) => r.split('{')[0].trim() === selector) ?? '';
  return rule.slice(rule.indexOf('{') + 1);
};

describe('premium section rules', () => {
  it('scopes every rule under the engine root and covers the collage layouts', () => {
    for (const cls of ['eng-collage', 'eng-collage--text-right', 'eng-collage--tiles', 'eng-collage--feature', 'eng-collage-tile']) {
      expect(PREMIUM_SECTION_RULES).toContain(cls);
    }
    const selectors = PREMIUM_SECTION_RULES.split('}')
      .map((r) => r.split('{')[0].trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(5);
    for (const sel of selectors) expect(sel.startsWith('.st-root.eng-root') || sel.startsWith('@container')).toBe(true);
  });

  it('portrait tiles are 3/4 and square tiles 1/1', () => {
    expect(ruleBody('.st-root.eng-root .eng-collage--portrait .eng-collage-tile')).toContain('aspect-ratio:3/4');
    expect(ruleBody('.st-root.eng-root .eng-collage--square .eng-collage-tile')).toContain('aspect-ratio:1/1');
  });

  it('stacks the text above the tiles, two tiles per row, until the store is wider than a phone', () => {
    const wide = PREMIUM_SECTION_RULES.indexOf('@container store (min-width:641px)');
    expect(wide).toBeGreaterThan(0);
    const base = PREMIUM_SECTION_RULES.slice(0, wide);
    expect(ruleBody('.st-root.eng-root .eng-collage')).toContain('grid-template-columns:minmax(0,1fr)');
    expect(ruleBody('.st-root.eng-root .eng-collage-grid')).toContain('repeat(2,minmax(0,1fr))');
    // Text 6 / tiles 6 only in the wide block.
    expect(base).not.toContain('repeat(2,minmax(0,1fr));gap:clamp(24px');
    expect(PREMIUM_SECTION_RULES.slice(wide)).toContain('repeat(2,minmax(0,1fr));gap:clamp(24px');
  });

  it('the text column swaps sides for text-right on wide screens only', () => {
    const wide = PREMIUM_SECTION_RULES.indexOf('@container store (min-width:641px)');
    const at = PREMIUM_SECTION_RULES.indexOf('.eng-collage--text-right .eng-collage-text{order:2}');
    expect(at).toBeGreaterThan(wide);
  });

  it('two featured tiles sit side by side with the first wider, not both spanning two rows', () => {
    const wide = PREMIUM_SECTION_RULES.slice(PREMIUM_SECTION_RULES.indexOf('@container store (min-width:641px)'));
    const grid = '.st-root.eng-root .eng-collage--feature:not(.eng-collage--tiles) .eng-collage-grid[data-count="2"]';
    expect(wide).toContain(grid);
    expect(ruleBody(grid)).toContain('grid-template-columns:2fr 1fr');
    expect(ruleBody(grid)).toContain('aspect-ratio:auto');
    expect(wide).not.toMatch(/data-count="2"\] \.eng-collage-tile\{[^}]*span 2/);
    // Each tile keeps the tile shape; the first tile is not told to span rows.
    expect(ruleBody('.st-root.eng-root .eng-collage--feature:not(.eng-collage--tiles).eng-collage--portrait .eng-collage-grid[data-count="2"] .eng-collage-tile')).toContain('aspect-ratio:3/4');
    expect(ruleBody(`${grid} .eng-collage-tile:first-child`)).toContain('grid-row:auto');
  });

  it('a tile with no picture has a dark background so its white caption stays readable', () => {
    expect(ruleBody('.st-root.eng-root .eng-collage-tile')).toContain('background:#2b2b2b');
  });
});
