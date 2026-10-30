import { presetTheme } from '@/lib/store/engine/presets';
import type { ThemeData } from '@/lib/store/engine/types';
import * as ops from '@/lib/store/engine/editor/ops';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

const mk = () => {
  let n = 0;
  return () => `p${++n}`;
};

describe('editor ops purity', () => {
  const theme = deepFreeze(presetTheme('studio', { businessName: 'Rose Mart', tagline: 'Fresh' }));
  const home = theme.templates.home;
  const secId = home.order.find((id) => home.sections[id].block_order.length > 1)!;
  const ref = { group: 'template' as const, id: secId };
  const blockId = home.sections[secId].block_order[0];
  const blockType = home.sections[secId].blocks[blockId].type;

  const cases: Array<[string, () => ops.OpResult | ThemeData]> = [
    ['addSection', () => ops.addSection(theme, 'home', 'template', 'rich-text', 0, 0, mk())],
    ['duplicateSection', () => ops.duplicateSection(theme, 'home', ref, mk())],
    ['removeSection', () => ops.removeSection(theme, 'home', ref)],
    ['moveSection', () => ops.moveSection(theme, 'home', 'template', 0, 1)],
    ['toggleSection', () => ops.toggleSection(theme, 'home', ref)],
    ['updateSection', () => ops.updateSection(theme, 'home', ref, { label: 'x', color_scheme: 'a', css_class: 'c', custom_css: 'b{}' })],
    ['setSectionSetting', () => ops.setSectionSetting(theme, 'home', ref, 'k', 1)],
    ['addBlock', () => ops.addBlock(theme, 'home', ref, blockType, 0, mk())],
    ['duplicateBlock', () => ops.duplicateBlock(theme, 'home', ref, blockId, mk())],
    ['removeBlock', () => ops.removeBlock(theme, 'home', ref, blockId)],
    ['moveBlock', () => ops.moveBlock(theme, 'home', ref, 0, 1)],
    ['toggleBlock', () => ops.toggleBlock(theme, 'home', ref, blockId)],
    ['setBlockSetting', () => ops.setBlockSetting(theme, 'home', ref, blockId, 'k', 1)],
    ['setThemeSetting', () => ops.setThemeSetting(theme, 'social.instagram', 'z')],
    ['setThemeSetting top-level', () => ops.setThemeSetting(theme, 'font_body', 'z')],
  ];

  it.each(cases)('%s does not mutate a frozen theme', (_name, run) => {
    const r = run();
    const next = 'ok' in r ? (r.ok ? r.theme : null) : r;
    expect(next).not.toBeNull();
    expect(next).not.toBe(theme);
  });

  it('template ops keep untouched groups by reference', () => {
    for (const [name, run] of cases) {
      if (name.startsWith('setThemeSetting')) continue;
      const r = run() as ops.OpResult;
      if (!r.ok) throw new Error(name);
      expect(r.theme.header_group).toBe(theme.header_group);
      expect(r.theme.footer_group).toBe(theme.footer_group);
      expect(r.theme.settings).toBe(theme.settings);
      expect(r.theme.templates.product).toBe(theme.templates.product);
    }
  });
});
