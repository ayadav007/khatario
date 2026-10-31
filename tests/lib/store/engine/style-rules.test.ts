import { STYLE_RULES } from '@/components/store/engine/style-rules';

it('scopes every rule under the engine root and covers each class', () => {
  for (const cls of ['eng-labels-caps', 'eng-frame-accent', 'eng-texture-dots', 'eng-texture-linen', 'eng-texture-grid']) expect(STYLE_RULES).toContain(`.eng-root.${cls}`);
  expect(STYLE_RULES).toContain('currentColor'); // textures draw in the section's text colour
});
