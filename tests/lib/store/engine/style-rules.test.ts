import { STYLE_RULES } from '@/components/store/engine/style-rules';

it('scopes every rule under the engine root and covers each class', () => {
  for (const cls of ['eng-labels-caps', 'eng-frame-accent', 'eng-texture-dots', 'eng-texture-linen', 'eng-texture-grid']) expect(STYLE_RULES).toContain(`.eng-root.${cls}`);
  expect(STYLE_RULES).toContain('currentColor'); // textures draw in the section's text colour
});

it('texture images and sizes are !important so they beat a section\'s inline background shorthand', () => {
  for (const t of ['dots', 'linen', 'grid']) {
    const rule = STYLE_RULES.split('}').find((r) => r.includes(`.eng-root.eng-texture-${t} .eng-sec{`)) ?? '';
    const decls = rule.slice(rule.indexOf('{') + 1).split(/;(?![^(]*\))/).filter(Boolean);
    const painted = decls.filter((d) => /^background-(image|size):/.test(d));
    expect(painted.length).toBeGreaterThan(0);
    for (const d of painted) expect(d).toMatch(/!important$/);
    expect(decls.some((d) => d.startsWith('background-image:'))).toBe(true);
    expect(decls.some((d) => /^background(-color)?:/.test(d))).toBe(false); // the section's own colour stays
  }
});
