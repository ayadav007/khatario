import {
  TREE_GROUPS,
  addBlockOptions,
  addSectionCards,
  blockLabel,
  groupRows,
  sectionLabel,
} from '@/lib/store/engine/editor/tree';
import { OP_ERROR_TEXT } from '@/lib/store/engine/editor/ops';
import { getSectionSchema, sectionsForTemplate } from '@/lib/store/engine/registry';
import { ENGINE_LIMITS } from '@/lib/store/engine/shared';
import type { Section, ThemeData } from '@/lib/store/engine/types';

const sec = (type: string, extra: Partial<Section> = {}): Section => ({
  type,
  settings: {},
  blocks: {},
  block_order: [],
  ...extra,
});

const theme = (): ThemeData => ({
  settings: {} as ThemeData['settings'],
  header_group: { order: ['hd'], sections: { hd: sec('header') } },
  footer_group: { order: ['ft'], sections: { ft: sec('footer') } },
  templates: {
    home: {
      order: ['a', 'b', 'gone', 'c'],
      sections: {
        a: sec('rich-text', { label: 'Our story' }),
        b: sec('multicolumn', {
          disabled: true,
          blocks: { c1: { type: 'column', settings: {} }, c2: { type: 'column', settings: {}, disabled: true }, x: { type: 'nope', settings: {} } },
          block_order: ['c1', 'c2', 'x'],
        }),
        c: sec('no-such-section'),
      },
    },
  },
});

describe('editor tree helpers', () => {
  it('lists the groups in tree order', () => {
    expect(TREE_GROUPS).toEqual([
      { group: 'header', title: 'Header' },
      { group: 'template', title: 'Home' },
      { group: 'footer', title: 'Footer' },
    ]);
  });

  it('labels a section by its label, then schema name, then type', () => {
    expect(sectionLabel(sec('rich-text', { label: 'Our story' }))).toBe('Our story');
    expect(sectionLabel(sec('rich-text'))).toBe('Rich text');
    expect(sectionLabel(sec('rich-text', { label: '' }))).toBe('Rich text');
    expect(sectionLabel(sec('no-such-section'))).toBe('no-such-section');
  });

  it('labels a block by its schema name, else its type', () => {
    expect(blockLabel('multicolumn', { type: 'column', settings: {} })).toBe('Column');
    expect(blockLabel('multicolumn', { type: 'nope', settings: {} })).toBe('nope');
    expect(blockLabel('no-such-section', { type: 'column', settings: {} })).toBe('column');
  });

  it('builds the rows of a group in order, skipping ids without a section', () => {
    const rows = groupRows(theme(), 'home', 'template');
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(rows[0]).toMatchObject({ ref: { group: 'template', id: 'a' }, index: 0, label: 'Our story', hidden: false, unknown: false });
    expect(rows[1]).toMatchObject({ index: 1, label: 'Multicolumn', hidden: true, unknown: false });
    expect(rows[2]).toMatchObject({ index: 3, label: 'no-such-section', hidden: false, unknown: true });
    expect(rows[1].blocks).toEqual([
      { id: 'c1', index: 0, label: 'Column', hidden: false, unknown: false },
      { id: 'c2', index: 1, label: 'Column', hidden: true, unknown: false },
      { id: 'x', index: 2, label: 'nope', hidden: false, unknown: true },
    ]);
    expect(groupRows(theme(), 'home', 'header').map((r) => r.label)).toEqual(['Header']);
    expect(groupRows(theme(), 'missing', 'template')).toEqual([]);
  });

  it('offers the schema block types with their disabled reasons', () => {
    const t = theme();
    expect(addBlockOptions(t, 'home', { group: 'template', id: 'b' })).toEqual([
      { type: 'column', name: 'Column', reason: null, reasonText: null },
    ]);
    expect(addBlockOptions(t, 'home', { group: 'template', id: 'a' })).toEqual([]);
    expect(addBlockOptions(t, 'home', { group: 'template', id: 'c' })).toEqual([]);
    // Fill multicolumn to its 6-column cap.
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
    t.templates.home.sections.b = sec('multicolumn', {
      blocks: Object.fromEntries(ids.map((id) => [id, { type: 'column', settings: {} }])),
      block_order: ids,
    });
    const [opt] = addBlockOptions(t, 'home', { group: 'template', id: 'b' });
    expect(opt.reason).toBe('block_limit');
    expect(opt.reasonText).toBe(OP_ERROR_TEXT.block_limit);
  });

  it('builds add-section cards per preset, grouped by category in registry order', () => {
    const groups = addSectionCards(theme(), 'home', 'template');
    const schemas = sectionsForTemplate('home');
    const cards = groups.flatMap((g) => g.cards);
    expect(cards.length).toBe(schemas.reduce((n, s) => n + s.presets.length, 0));
    expect(groups.map((g) => g.category)).toEqual(Array.from(new Set(schemas.map((s) => s.category))));
    for (const g of groups) for (const c of g.cards) expect(getSectionSchema(c.type)?.category).toBe(g.category);

    const banner = cards.find((c) => c.type === 'image-banner');
    expect(banner).toEqual({
      key: 'image-banner:0',
      type: 'image-banner',
      presetIndex: 0,
      title: 'Image banner',
      schemaName: 'Image banner',
      presetName: 'Image banner',
      reason: null,
      reasonText: null,
    });

  });

  it('names cards "<schema name> · <preset name>" when a schema has several presets', () => {
    jest.isolateModules(() => {
      jest.doMock('@/lib/store/engine/registry', () => {
        const actual = jest.requireActual('@/lib/store/engine/registry');
        const twin = { ...actual.getSectionSchema('rich-text'), presets: [{ name: 'Plain' }, { name: 'Boxed' }] };
        return {
          ...actual,
          getSectionSchema: (t: string) => (t === 'rich-text' ? twin : actual.getSectionSchema(t)),
          sectionsForTemplate: (k: string) =>
            actual.sectionsForTemplate(k).map((s: { type: string }) => (s.type === 'rich-text' ? twin : s)),
        };
      });
      const tree = require('@/lib/store/engine/editor/tree') as typeof import('@/lib/store/engine/editor/tree');
      const cards = tree.addSectionCards(theme(), 'home', 'template').flatMap((g) => g.cards);
      expect(cards.filter((c) => c.type === 'rich-text').map((c) => [c.key, c.title, c.presetIndex, c.presetName])).toEqual([
        ['rich-text:0', 'Rich text · Plain', 0, 'Plain'],
        ['rich-text:1', 'Rich text · Boxed', 1, 'Boxed'],
      ]);
    });
  });

  it('disables cards that cannot be added, with the op error text', () => {
    const header = addSectionCards(theme(), 'home', 'header').flatMap((g) => g.cards);
    const hdr = header.filter((c) => c.type === 'header');
    expect(hdr.length).toBeGreaterThan(0);
    for (const c of hdr) {
      expect(c.reason).toBe('type_limit');
      expect(c.reasonText).toBe(OP_ERROR_TEXT.type_limit);
    }
    expect(header.find((c) => c.type === 'announcement')?.reason).toBeNull();

    const full = theme();
    const order = Array.from({ length: ENGINE_LIMITS.sectionsPerTemplate }, (_, i) => `s${i}`);
    full.templates.home = { order, sections: Object.fromEntries(order.map((id) => [id, sec('rich-text')])) };
    for (const c of addSectionCards(full, 'home', 'template').flatMap((g) => g.cards)) {
      expect(c.reason).toBe('section_limit');
    }
  });
});
