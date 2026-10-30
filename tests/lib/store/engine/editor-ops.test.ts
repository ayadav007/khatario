import { presetTheme } from '@/lib/store/engine/presets';
import { defaultTemplate } from '@/lib/store/engine/presets/templates';
import type { ThemeData } from '@/lib/store/engine/types';
import {
  addBlock, addSection, canAddBlock, canAddSection, duplicateBlock, duplicateSection, fillTemplate, getGroup, moveBlock,
  moveSection, removeBlock, removeSection, setBlockSetting, setSectionSetting, setThemeSetting, templateKind,
  toggleBlock, toggleSection, updateSection,
} from '@/lib/store/engine/editor/ops';

const ctx = { businessName: 'Rose Mart', tagline: 'Fresh', accent: '#e11d48' };
const fixture = () => presetTheme('studio', ctx);
const ids = () => {
  let n = 0;
  return () => `s${++n}`;
};
const ok = (r: any) => {
  expect(r.ok).toBe(true);
  return r.theme as ThemeData;
};

describe('editor ops', () => {
  it('templateKind maps groups and keys', () => {
    expect(templateKind('home', 'header')).toBe('header');
    expect(templateKind('home', 'footer')).toBe('footer');
    expect(templateKind('product', 'template')).toBe('product');
    expect(templateKind('page.about', 'template')).toBe('page');
  });

  it('addSection inserts at index with schema defaults and preset settings and blocks', () => {
    const t = fixture();
    const r: any = addSection(t, 'home', 'template', 'multicolumn', 1, 0, ids());
    const next = ok(r);
    const g = getGroup(next, 'home', 'template');
    expect(g.order[1]).toBe(r.id);
    expect(g.order).toHaveLength(getGroup(t, 'home', 'template').order.length + 1);
    const s = g.sections[r.id];
    expect(s.type).toBe('multicolumn');
    expect(s.settings.spacing_top).toBe(32);
    expect(s.block_order.length).toBeGreaterThan(0);
    expect(s.blocks[s.block_order[0]].type).toBe('column');
  });

  it('addSection refuses a type not allowed in the group', () => {
    const t = fixture();
    expect(addSection(t, 'home', 'template', 'header', 0)).toEqual({ ok: false, reason: 'not_allowed_here' });
    expect(addSection(t, 'home', 'template', 'nope', 0)).toEqual({ ok: false, reason: 'unknown_type' });
  });

  it('addSection refuses the 26th section', () => {
    let t = fixture();
    const mk = ids();
    while (getGroup(t, 'home', 'template').order.length < 25) t = ok(addSection(t, 'home', 'template', 'rich-text', 0, 0, mk));
    expect(addSection(t, 'home', 'template', 'rich-text', 0, 0, mk)).toEqual({ ok: false, reason: 'section_limit' });
  });

  it('addSection refuses a second section past its own limit', () => {
    const t = fixture();
    const hg = getGroup(t, 'home', 'header');
    expect(hg.order.some((id) => hg.sections[id].type === 'header')).toBe(true);
    expect(addSection(t, 'home', 'header', 'header', 0)).toEqual({ ok: false, reason: 'type_limit' });
  });

  it('addBlock refuses past a section block cap and unknown block types', () => {
    let t = fixture();
    const mk = ids();
    const ref = { group: 'footer' as const, id: getGroup(t, 'home', 'footer').order[0] };
    while (getGroup(t, 'home', 'footer').sections[ref.id].block_order.length < 4) {
      t = ok(addBlock(t, 'home', ref, 'link_column', 0, mk));
    }
    expect(addBlock(t, 'home', ref, 'link_column', 0)).toEqual({ ok: false, reason: 'block_limit' });
    expect(addBlock(t, 'home', ref, 'bogus', 0)).toEqual({ ok: false, reason: 'unknown_block_type' });
  });

  it('addBlock uses the engine cap without max_blocks and enforces a block type limit', () => {
    jest.isolateModules(() => {
      jest.doMock('@/lib/store/engine/registry', () => {
        const schema = {
          type: 'fake', name: 'Fake', category: 'Text', templates: ['home'], settings: [],
          blocks: [{ type: 'a', name: 'A', limit: 2, settings: [] }, { type: 'b', name: 'B', settings: [] }],
          presets: [{ name: 'Fake' }],
        };
        return { getSectionSchema: (t: string) => (t === 'fake' ? schema : null), sectionsForTemplate: () => [schema] };
      });
      const ops = require('@/lib/store/engine/editor/ops');
      let t: ThemeData = {
        settings: {} as any,
        header_group: { order: [], sections: {} },
        footer_group: { order: [], sections: {} },
        templates: { home: { order: [], sections: {} } },
      };
      const r = ops.addSection(t, 'home', 'template', 'fake', 0, 0, ids());
      t = r.theme;
      const ref = { group: 'template', id: r.id };
      const mk = ids();
      t = ops.addBlock(t, 'home', ref, 'a', 0, mk).theme;
      t = ops.addBlock(t, 'home', ref, 'a', 0, mk).theme;
      expect(ops.addBlock(t, 'home', ref, 'a', 0)).toEqual({ ok: false, reason: 'block_type_limit' });
      while (t.templates.home.sections[r.id].block_order.length < 50) t = ops.addBlock(t, 'home', ref, 'b', 0, mk).theme;
      expect(ops.addBlock(t, 'home', ref, 'b', 0)).toEqual({ ok: false, reason: 'block_limit' });
      expect(ops.canAddBlock(t, 'home', ref, 'b')).toBe('block_limit');
    });
    jest.dontMock('@/lib/store/engine/registry');
  });

  it('duplicateSection copies settings and blocks with new block ids and places it after the original', () => {
    const t = fixture();
    const g = getGroup(t, 'home', 'template');
    const srcId = g.order.find((id) => g.sections[id].block_order.length > 0)!;
    const r: any = duplicateSection(t, 'home', { group: 'template', id: srcId }, ids());
    const next = ok(r);
    const ng = getGroup(next, 'home', 'template');
    expect(ng.order.indexOf(r.id)).toBe(ng.order.indexOf(srcId) + 1);
    const a = g.sections[srcId];
    const b = ng.sections[r.id];
    expect(b.settings).toEqual(a.settings);
    expect(b.block_order).toHaveLength(a.block_order.length);
    expect(b.block_order.some((id) => a.block_order.includes(id))).toBe(false);
    expect(b.block_order.map((id) => b.blocks[id])).toEqual(a.block_order.map((id) => a.blocks[id]));
  });

  it('new section ids are unused across header, footer and every template', () => {
    const t = fixture();
    const taken = t.header_group.order[0];
    const seq = [taken, taken, 'fresh1'];
    let i = 0;
    const r: any = addSection(t, 'home', 'template', 'rich-text', 0, 0, () => seq[Math.min(i++, 2)]);
    expect(r.id).toBe('fresh1');
    const stuck: any = addSection(t, 'home', 'template', 'rich-text', 0, 0, () => taken);
    expect(stuck.ok).toBe(true);
    expect(stuck.id).not.toBe(taken);
    expect(/^[a-z0-9_-]{1,32}$/.test(stuck.id)).toBe(true);
  });

  it('moveSection and moveBlock reorder only the order arrays; out-of-range indexes return not_found', () => {
    const t = fixture();
    const g = getGroup(t, 'home', 'template');
    const moved = ok(moveSection(t, 'home', 'template', 0, 1));
    const mg = getGroup(moved, 'home', 'template');
    expect(mg.order[1]).toBe(g.order[0]);
    expect(mg.sections).toBe(g.sections);
    expect(moveSection(t, 'home', 'template', 0, 99)).toEqual({ ok: false, reason: 'not_found' });
    expect(moveSection(t, 'home', 'template', -1, 0)).toEqual({ ok: false, reason: 'not_found' });
    const hg = getGroup(t, 'home', 'header');
    const hid = hg.order.find((id) => hg.sections[id].block_order.length > 1)!;
    const ref = { group: 'header' as const, id: hid };
    const bm = ok(moveBlock(t, 'home', ref, 0, 1));
    const s = getGroup(bm, 'home', 'header').sections[hid];
    expect(s.block_order[1]).toBe(hg.sections[hid].block_order[0]);
    expect(s.blocks).toBe(hg.sections[hid].blocks);
    expect(moveBlock(t, 'home', ref, 0, 99)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('removeSection removes it from order and sections', () => {
    const t = fixture();
    const id = getGroup(t, 'home', 'template').order[0];
    const next = getGroup(ok(removeSection(t, 'home', { group: 'template', id })), 'home', 'template');
    expect(next.order).not.toContain(id);
    expect(next.sections[id]).toBeUndefined();
    expect(removeSection(t, 'home', { group: 'template', id: 'zzz' })).toEqual({ ok: false, reason: 'not_found' });
  });

  it('section and block edits: toggle, update, settings, duplicate, remove', () => {
    let t = fixture();
    const g = getGroup(t, 'home', 'template');
    const id = g.order.find((x) => g.sections[x].block_order.length > 0)!;
    const ref = { group: 'template' as const, id };
    const sec = () => getGroup(t, 'home', 'template').sections[id];
    t = ok(toggleSection(t, 'home', ref));
    expect(sec().disabled).toBe(true);
    t = ok(toggleSection(t, 'home', ref));
    expect('disabled' in sec()).toBe(false);
    t = ok(updateSection(t, 'home', ref, { label: 'Hero', css_class: 'x' }));
    expect(sec().label).toBe('Hero');
    t = ok(updateSection(t, 'home', ref, { label: '' }));
    expect('label' in sec()).toBe(false);
    t = ok(setSectionSetting(t, 'home', ref, 'spacing_top', 8));
    expect(sec().settings.spacing_top).toBe(8);
    const bid = sec().block_order[0];
    t = ok(setBlockSetting(t, 'home', ref, bid, 'k', 'v'));
    expect(sec().blocks[bid].settings.k).toBe('v');
    t = ok(toggleBlock(t, 'home', ref, bid));
    expect(sec().blocks[bid].disabled).toBe(true);
    const d: any = duplicateBlock(t, 'home', ref, bid, ids());
    expect(getGroup(d.theme, 'home', 'template').sections[id].block_order[1]).toBe(d.id);
    t = ok(removeBlock(t, 'home', ref, bid));
    expect(sec().blocks[bid]).toBeUndefined();
    expect(sec().block_order).not.toContain(bid);
    expect(toggleBlock(t, 'home', ref, 'nope')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('setThemeSetting handles dotted social keys', () => {
    const t = fixture();
    const n = setThemeSetting(t, 'social.instagram', 'abc');
    expect(n.settings.social.instagram).toBe('abc');
    expect(n.settings.social.whatsapp).toBe(t.settings.social.whatsapp);
    expect(setThemeSetting(t, 'font_body', 'X').settings.font_body).toBe('X');
  });

  it('operations leave the input theme unchanged and reuse untouched groups by reference', () => {
    const t = fixture();
    const snapshot = JSON.stringify(t);
    const g = getGroup(t, 'home', 'template');
    const next = ok(addSection(t, 'home', 'template', 'rich-text', 0, 0, ids()));
    ok(duplicateSection(t, 'home', { group: 'template', id: g.order[0] }, ids()));
    ok(removeSection(t, 'home', { group: 'template', id: g.order[0] }));
    expect(JSON.stringify(t)).toBe(snapshot);
    expect(next.header_group).toBe(t.header_group);
    expect(next.footer_group).toBe(t.footer_group);
    expect(next.templates.product).toBe(t.templates.product);
    expect(next.settings).toBe(t.settings);
  });

  it('canAddSection matches addSection refusal reasons', () => {
    const t = fixture();
    for (const [key, group, type] of [
      ['home', 'template', 'header'],
      ['home', 'template', 'nope'],
      ['home', 'header', 'header'],
      ['home', 'template', 'rich-text'],
    ] as const) {
      const r = addSection(t, key, group, type, 0);
      expect(canAddSection(t, key, group, type)).toBe(r.ok ? null : r.reason);
    }
    const ref = { group: 'footer' as const, id: getGroup(t, 'home', 'footer').order[0] };
    expect(canAddBlock(t, 'home', ref, 'bogus')).toBe('unknown_block_type');
  });

  it('move ops accept the first and last index and refuse out-of-range', () => {
    const t = fixture();
    const g = getGroup(t, 'home', 'template');
    const last = g.order.length - 1;
    expect(getGroup(ok(moveSection(t, 'home', 'template', 0, last)), 'home', 'template').order[last]).toBe(g.order[0]);
    expect(getGroup(ok(moveSection(t, 'home', 'template', last, 0)), 'home', 'template').order[0]).toBe(g.order[last]);
    expect(moveSection(t, 'home', 'template', last + 1, 0)).toEqual({ ok: false, reason: 'not_found' });
    expect(moveSection(t, 'home', 'template', 0, last + 1)).toEqual({ ok: false, reason: 'not_found' });
    const hg = getGroup(t, 'home', 'header');
    const hid = hg.order.find((id) => hg.sections[id].block_order.length > 1)!;
    const ref = { group: 'header' as const, id: hid };
    const bo = hg.sections[hid].block_order;
    const bl = bo.length - 1;
    const sec = (th: ThemeData) => getGroup(th, 'home', 'header').sections[hid];
    expect(sec(ok(moveBlock(t, 'home', ref, 0, bl))).block_order[bl]).toBe(bo[0]);
    expect(sec(ok(moveBlock(t, 'home', ref, bl, 0))).block_order[0]).toBe(bo[bl]);
    expect(moveBlock(t, 'home', ref, -1, 0)).toEqual({ ok: false, reason: 'not_found' });
    expect(moveBlock(t, 'home', ref, 0, bl + 1)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('updateSection sets and clears color_scheme and custom_css, and trims label', () => {
    let t = fixture();
    const id = getGroup(t, 'home', 'template').order[0];
    const ref = { group: 'template' as const, id };
    const sec = () => getGroup(t, 'home', 'template').sections[id];
    t = ok(updateSection(t, 'home', ref, { color_scheme: 'scheme-2', custom_css: 'a{b:c}', label: '  Hero  ' }));
    expect(sec().color_scheme).toBe('scheme-2');
    expect(sec().custom_css).toBe('a{b:c}');
    expect(sec().label).toBe('Hero');
    t = ok(updateSection(t, 'home', ref, { color_scheme: '', custom_css: undefined, label: '   ' }));
    expect('color_scheme' in sec()).toBe(false);
    expect('custom_css' in sec()).toBe(false);
    expect('label' in sec()).toBe(false);
  });

  it('duplicateBlock is refused at the block limit', () => {
    let t = fixture();
    const mk = ids();
    const ref = { group: 'footer' as const, id: getGroup(t, 'home', 'footer').order[0] };
    while (getGroup(t, 'home', 'footer').sections[ref.id].block_order.length < 4) t = ok(addBlock(t, 'home', ref, 'link_column', 0, mk));
    const bid = getGroup(t, 'home', 'footer').sections[ref.id].block_order[0];
    expect(duplicateBlock(t, 'home', ref, bid, mk)).toEqual({ ok: false, reason: 'block_limit' });
  });
});

describe('fillTemplate', () => {
  const emptied = (key: 'product' | 'catalog'): ThemeData => {
    const t = fixture();
    return { ...t, templates: { ...t.templates, [key]: { order: [], sections: {} } } };
  };

  it('fills an empty product template with fresh ids unique across the theme', () => {
    const t = emptied('product');
    const used = getGroup(t, 'home', 'template').order[0];
    const tpl = defaultTemplate('product');
    // A clash with a section already in the theme gets a new id.
    const clash = { order: [used, ...tpl.order.slice(1)], sections: { [used]: tpl.sections[tpl.order[0]], ...tpl.sections } };
    delete clash.sections[tpl.order[0]];
    const next = ok(fillTemplate(t, 'product', clash));
    const g = getGroup(next, 'product', 'template');
    expect(g.order).toHaveLength(tpl.order.length);
    expect(g.order).not.toContain(used);
    expect(g.order.map((id) => g.sections[id].type)).toEqual(tpl.order.map((id) => tpl.sections[id].type));
    expect(new Set(g.order).size).toBe(g.order.length);
    expect(getGroup(next, 'home', 'template')).toEqual(getGroup(t, 'home', 'template'));
  });

  it('fills an empty catalog template', () => {
    const next = ok(fillTemplate(emptied('catalog'), 'catalog', defaultTemplate('catalog')));
    const g = getGroup(next, 'catalog', 'template');
    expect(g.order.map((id) => g.sections[id].type)).toEqual(['catalog-banner', 'main-catalog']);
  });

  it('refuses a template that already has sections, or is missing', () => {
    const t = fixture();
    expect(getGroup(t, 'product', 'template').order.length).toBeGreaterThan(0);
    expect(fillTemplate(t, 'product', defaultTemplate('product'))).toEqual({ ok: false, reason: 'not_found' });
    const { catalog: _gone, ...rest } = t.templates;
    expect(fillTemplate({ ...t, templates: rest }, 'catalog', defaultTemplate('catalog'))).toEqual({ ok: false, reason: 'not_found' });
  });
});
