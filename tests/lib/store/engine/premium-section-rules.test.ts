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
    for (const sel of selectors) expect(sel.startsWith('.st-root.eng-root') || sel.startsWith('@container') || sel.startsWith('@media')).toBe(true);
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

  it('shop the look: photo 7 / list 5 on wide screens, stacked photo then list on phones, image-right swaps order', () => {
    const wideAt = PREMIUM_SECTION_RULES.lastIndexOf('@container store (min-width:641px)');
    const base = PREMIUM_SECTION_RULES.slice(0, wideAt);
    const wide = PREMIUM_SECTION_RULES.slice(wideAt);
    expect(ruleBody('.st-root.eng-root .eng-look')).toContain('grid-template-columns:minmax(0,1fr)');
    expect(base).not.toContain('7fr');
    expect(wide).toContain('grid-template-columns:minmax(0,7fr) minmax(0,5fr)');
    expect(wide).toContain('.eng-look--right .eng-look-photo{order:2}');
    expect(base).not.toContain('.eng-look--right');
  });

  it('shop the look: pins are 28px circles in the button colours and the card sits on the card colours', () => {
    const pin = ruleBody('.st-root.eng-root .eng-look-pin');
    expect(pin).toContain('width:28px');
    expect(pin).toContain('height:28px');
    expect(pin).toContain('border-radius:50%');
    expect(pin).toContain('var(--c-btn');
    expect(pin).toContain('var(--c-btn-text');
    const card = ruleBody('.st-root.eng-root .eng-look-card');
    expect(card).toContain('var(--c-card');
    expect(card).toContain('var(--c-border');
    expect(card).toContain('box-shadow');
  });

  it('shop the look: the empty-state note is for the editor only', () => {
    expect(ruleBody('.st-root.eng-root:not(.eng-editor) .eng-look-empty')).toContain('display:none');
  });
  it('image gallery: grid columns, masonry columns and a snapping strip from the --eng-cols variable', () => {
    expect(ruleBody('.st-root.eng-root .eng-gallery--grid .eng-gallery-list')).toContain('grid-template-columns:repeat(var(--eng-cols),minmax(0,1fr))');
    expect(ruleBody('.st-root.eng-root .eng-gallery--masonry .eng-gallery-list')).toContain('columns:var(--eng-cols)');
    const strip = ruleBody('.st-root.eng-root .eng-gallery--strip .eng-gallery-list');
    expect(strip).toContain('display:flex');
    expect(strip).toContain('overflow-x:auto');
    expect(strip).toContain('scroll-snap-type:x mandatory');
    expect(ruleBody('.st-root.eng-root .eng-gallery--strip .eng-gallery-item')).toContain('flex:0 0 calc(100%/var(--eng-cols))');
  });

  it('image gallery: square is 1/1, portrait 3/4, natural has no ratio', () => {
    expect(ruleBody('.st-root.eng-root .eng-gallery--square .eng-gallery-media')).toContain('aspect-ratio:1/1');
    expect(ruleBody('.st-root.eng-root .eng-gallery--portrait .eng-gallery-media')).toContain('aspect-ratio:3/4');
    expect(PREMIUM_SECTION_RULES).not.toContain('eng-gallery--natural .eng-gallery-media{aspect-ratio');
  });

  it('image gallery: captions fade in on hover or focus, stay visible without hover, and hide for hover-none', () => {
    expect(ruleBody('.st-root.eng-root .eng-gallery-cap')).toContain('opacity:0');
    expect(PREMIUM_SECTION_RULES).toContain('.eng-gallery-item:hover .eng-gallery-cap');
    expect(PREMIUM_SECTION_RULES).toContain('.eng-gallery-item:focus-within .eng-gallery-cap');
    const none = PREMIUM_SECTION_RULES.indexOf('@media (hover:none)');
    expect(none).toBeGreaterThan(0);
    expect(PREMIUM_SECTION_RULES.slice(none)).toContain('.eng-gallery-cap{opacity:1}');
    expect(ruleBody('.st-root.eng-root .eng-gallery--hover-none .eng-gallery-cap')).toContain('display:none');
  });

  it('image gallery: two columns on phones, except the strip which keeps its own', () => {
    const phone = PREMIUM_SECTION_RULES.indexOf('@container store (max-width:640px){.st-root.eng-root .eng-gallery:not(.eng-gallery--strip)');
    expect(phone).toBeGreaterThan(0);
    const phoneBlock = PREMIUM_SECTION_RULES.slice(phone, PREMIUM_SECTION_RULES.indexOf('}}', phone));
    // !important is what beats the renderer's inline --eng-cols.
    expect(phoneBlock).toContain('--eng-cols:2!important');
  });

  it('image gallery: on phones the strip shows about two cards with the next peeking, whatever its columns; wide keeps columns', () => {
    const phoneAt = PREMIUM_SECTION_RULES.indexOf('@container store (max-width:640px){.st-root.eng-root .eng-gallery:not(.eng-gallery--strip)');
    const phoneBlock = PREMIUM_SECTION_RULES.slice(phoneAt, PREMIUM_SECTION_RULES.indexOf('}}', phoneAt));
    expect(phoneBlock).toContain('.st-root.eng-root .eng-gallery--strip .eng-gallery-item{flex:0 0 calc(100%/2.2)');
    expect(ruleBody('.st-root.eng-root .eng-gallery--strip .eng-gallery-item')).toContain('flex:0 0 calc(100%/var(--eng-cols))');
    // The phone override comes after the base rule so it wins at equal specificity.
    expect(PREMIUM_SECTION_RULES.indexOf('calc(100%/2.2)')).toBeGreaterThan(PREMIUM_SECTION_RULES.indexOf('calc(100%/var(--eng-cols))'));
  });
});

describe('premium section gutters', () => {
  const S = ':is(.eng-collage,.eng-look-sec,.eng-gallery)';
  const at = (query: string, rule: string) => `@container store (${query}){${rule}}`;

  it('keeps Collage, Shop the look and Image gallery off the store edges like the other sections (38 / 22 / 14 px)', () => {
    expect(ruleBody(`.st-root.eng-root ${S}`)).toContain('padding-inline:38px');
    expect(PREMIUM_SECTION_RULES).toContain(at('max-width:900px', `.st-root.eng-root ${S}{padding-inline:22px}`));
    expect(PREMIUM_SECTION_RULES).toContain(at('max-width:640px', `.st-root.eng-root ${S}{padding-inline:14px}`));
  });

  it('centres them in the 1240px column on wide Studio-based stores, and Full width drops the gutter', () => {
    expect(PREMIUM_SECTION_RULES).toContain(at('min-width:1320px', `.st-root.eng-root.store-studio ${S}{padding-inline:calc((100cqw - 1240px) / 2)}`));
    expect(PREMIUM_SECTION_RULES).toContain(`.st-root.eng-root .eng-sec--full ${S}{padding-inline:0}`);
  });
});
