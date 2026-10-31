import { presetTheme } from '@/lib/store/engine/presets';
import type { Menu, MenuItem, ThemeData } from '@/lib/store/engine/types';
import { OP_ERROR_TEXT, type OpResult } from '@/lib/store/engine/editor/ops';
import * as m from '@/lib/store/engine/editor/menu-ops';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

const mk = () => {
  let n = 0;
  return (p?: string) => `${p ?? 'x'}-n${++n}`;
};

const it_ = (id: string, children?: MenuItem[], extra: Partial<MenuItem> = {}): MenuItem => ({
  id,
  label: id.toUpperCase(),
  link: '',
  ...(children ? { children } : {}),
  ...extra,
});

function base(menus: Menu[]): ThemeData {
  const t = presetTheme('studio', { businessName: 'Rose Mart', tagline: 'Fresh' });
  return { ...t, settings: { ...t.settings, menus } };
}

const menuOf = (r: OpResult, id: string): Menu => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.theme.settings.menus.find((x) => x.id === id)!;
};
const reason = (r: OpResult) => (r.ok ? null : r.reason);
const newIdOf = (r: OpResult): string => {
  if (!r.ok || !r.id) throw new Error('expected an id');
  return r.id;
};
const ids = (items: MenuItem[]): string[] => items.flatMap((i) => [i.id, ...ids(i.children ?? [])]);
const twelve = (prefix: string) => Array.from({ length: 12 }, (_, i) => it_(`${prefix}${i}`));

describe('menus: add, rename, remove', () => {
  it('addMenu gives a new id, trims the name, defaults empty to Menu, fails at 10', () => {
    const t = base([{ id: 'main', name: 'Main', items: [] }]);
    const r = m.addMenu(t, '  Sale  ', mk());
    expect(menuOf(r, newIdOf(r))).toEqual({ id: newIdOf(r), name: 'Sale', items: [] });
    const blank = m.addMenu(t, '   ', mk());
    expect(menuOf(blank, newIdOf(blank)).name).toBe('Menu');
    const ten = base(Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, name: `M${i}`, items: [] })));
    expect(reason(m.addMenu(ten, 'x'))).toBe('menu_limit');
  });

  it('addMenu never reuses an existing id', () => {
    const t = base([{ id: 'dup-n1', name: 'D', items: [] }]);
    const r = m.addMenu(t, 'x', () => 'dup-n1');
    expect(newIdOf(r)).not.toBe('dup-n1');
  });

  it('renameMenu renames or fails not_found', () => {
    const t = base([{ id: 'main', name: 'Main', items: [] }]);
    expect(menuOf(m.renameMenu(t, 'main', ' Top '), 'main').name).toBe('Top');
    expect(reason(m.renameMenu(t, 'nope', 'x'))).toBe('not_found');
  });

  it('removeMenu refuses main (header default) and footer, removes an unused menu', () => {
    const t = base([
      { id: 'main', name: 'Main', items: [] },
      { id: 'footer', name: 'Footer', items: [] },
      { id: 'sale', name: 'Sale', items: [] },
    ]);
    expect(reason(m.removeMenu(t, 'main'))).toBe('menu_in_use');
    expect(reason(m.removeMenu(t, 'footer'))).toBe('menu_in_use');
    const r = m.removeMenu(t, 'sale');
    expect(r.ok && r.theme.settings.menus.map((x) => x.id)).toEqual(['main', 'footer']);
    expect(reason(m.removeMenu(t, 'nope'))).toBe('not_found');
  });

  it('menuInUse reads the menu setting, defaults, and counts disabled sections', () => {
    const t = base([{ id: 'sale', name: 'Sale', items: [] }]);
    const hid = Object.keys(t.header_group.sections).find((k) => t.header_group.sections[k].type === 'header')!;
    const fid = Object.keys(t.footer_group.sections).find((k) => t.footer_group.sections[k].type === 'footer')!;
    const withSettings = (menuH?: string, menuF?: string, disabled = false): ThemeData => {
      const hs: Record<string, unknown> = { ...t.header_group.sections[hid].settings };
      const fs: Record<string, unknown> = { ...t.footer_group.sections[fid].settings };
      delete hs.menu;
      delete fs.menu;
      if (menuH !== undefined) hs.menu = menuH;
      if (menuF !== undefined) fs.menu = menuF;
      return {
        ...t,
        header_group: { ...t.header_group, sections: { ...t.header_group.sections, [hid]: { ...t.header_group.sections[hid], settings: hs, disabled } } },
        footer_group: { ...t.footer_group, sections: { ...t.footer_group.sections, [fid]: { ...t.footer_group.sections[fid], settings: fs, disabled } } },
      };
    };
    expect(m.menuInUse(withSettings(), 'main')).toBe(true);
    expect(m.menuInUse(withSettings(), 'footer')).toBe(true);
    expect(m.menuInUse(withSettings(), 'sale')).toBe(false);
    expect(m.menuInUse(withSettings('sale', 'sale'), 'sale')).toBe(true);
    expect(m.menuInUse(withSettings('sale', 'sale'), 'main')).toBe(false);
    expect(m.menuInUse(withSettings('sale', 'sale', true), 'sale')).toBe(true);
  });

  it('error texts', () => {
    expect(OP_ERROR_TEXT.menu_limit).toBe('A theme can have up to 10 menus');
    expect(OP_ERROR_TEXT.menu_item_limit).toBe('A menu level can have up to 12 items');
    expect(OP_ERROR_TEXT.menu_depth).toBe('Menus go three levels deep');
    expect(OP_ERROR_TEXT.menu_in_use).toBe('Used by the Header or Footer. Pick another menu there first.');
  });
});

describe('menu items', () => {
  it('findMenuItem gives an item and its level, or null', () => {
    const items = [it_('a', [it_('b', [it_('c')])]), it_('d')];
    expect(m.findMenuItem(items, 'a')).toEqual({ item: items[0], level: 1 });
    expect(m.findMenuItem(items, 'b')?.level).toBe(2);
    expect(m.findMenuItem(items, 'c')).toEqual({ item: items[0].children![0].children![0], level: 3 });
    expect(m.findMenuItem(items, 'd')?.level).toBe(1);
    expect(m.findMenuItem(items, 'zz')).toBeNull();
  });

  it('addMenuItem appends a New link at top or under a parent', () => {
    const t = base([{ id: 'main', name: 'Main', items: [it_('a', [it_('a1')])] }]);
    const top = m.addMenuItem(t, 'main', null, mk());
    const topMenu = menuOf(top, 'main');
    expect(topMenu.items.map((i) => i.id)).toEqual(['a', newIdOf(top)]);
    expect(topMenu.items[1]).toEqual({ id: newIdOf(top), label: 'New link', link: '' });
    const sub = m.addMenuItem(t, 'main', 'a', mk());
    expect(menuOf(sub, 'main').items[0].children!.map((i) => i.id)).toEqual(['a1', newIdOf(sub)]);
    expect(reason(m.addMenuItem(t, 'nope', null))).toBe('not_found');
    expect(reason(m.addMenuItem(t, 'main', 'nope'))).toBe('not_found');
  });

  it('addMenuItem refuses a full level, a level-3 parent and a categories parent', () => {
    const t = base([
      { id: 'main', name: 'Main', items: [it_('a', [it_('b', [it_('c')])]), it_('cat', undefined, { source: 'categories' })] },
      { id: 'full', name: 'Full', items: twelve('i') },
    ]);
    expect(reason(m.addMenuItem(t, 'full', null))).toBe('menu_item_limit');
    expect(reason(m.addMenuItem(t, 'main', 'c'))).toBe('menu_depth');
    expect(reason(m.addMenuItem(t, 'main', 'cat'))).toBe('not_allowed_here');
    const fullKids = base([{ id: 'main', name: 'Main', items: [it_('a', twelve('k'))] }]);
    expect(reason(m.addMenuItem(fullKids, 'main', 'a'))).toBe('menu_item_limit');
  });

  it('updateMenuItem patches fields but keeps id and children', () => {
    const t = base([{ id: 'main', name: 'Main', items: [it_('a', [it_('a1')])] }]);
    const r = m.updateMenuItem(t, 'main', 'a', { label: 'Shop', link: '/catalog', highlight: true });
    const a = menuOf(r, 'main').items[0];
    expect(a).toMatchObject({ id: 'a', label: 'Shop', link: '/catalog', highlight: true });
    expect(a.children!.map((i) => i.id)).toEqual(['a1']);
    const nested = menuOf(m.updateMenuItem(t, 'main', 'a1', { label: 'Sub' }), 'main').items[0].children![0];
    expect(nested.label).toBe('Sub');
    expect(reason(m.updateMenuItem(t, 'main', 'zz', { label: 'x' }))).toBe('not_found');
  });

  it('moveMenuItem up and down swap within the level; the ends are not_found', () => {
    const t = base([{ id: 'main', name: 'Main', items: [it_('a'), it_('b'), it_('c')] }]);
    expect(ids(menuOf(m.moveMenuItem(t, 'main', 'b', 'up'), 'main').items)).toEqual(['b', 'a', 'c']);
    expect(ids(menuOf(m.moveMenuItem(t, 'main', 'b', 'down'), 'main').items)).toEqual(['a', 'c', 'b']);
    expect(reason(m.moveMenuItem(t, 'main', 'a', 'up'))).toBe('not_found');
    expect(reason(m.moveMenuItem(t, 'main', 'c', 'down'))).toBe('not_found');
  });

  it('moveMenuItem in makes the item the last child of the previous sibling', () => {
    const t = base([{ id: 'main', name: 'Main', items: [it_('a', [it_('a1')]), it_('b')] }]);
    const a = menuOf(m.moveMenuItem(t, 'main', 'b', 'in'), 'main').items;
    expect(a).toHaveLength(1);
    expect(a[0].children!.map((i) => i.id)).toEqual(['a1', 'b']);
    expect(reason(m.moveMenuItem(t, 'main', 'a', 'in'))).toBe('not_found');
  });

  it('moveMenuItem in refuses a categories sibling, a full parent and too deep a subtree', () => {
    const cat = base([{ id: 'main', name: 'Main', items: [it_('cat', undefined, { source: 'categories' }), it_('b')] }]);
    expect(reason(m.moveMenuItem(cat, 'main', 'b', 'in'))).toBe('not_allowed_here');
    const full = base([{ id: 'main', name: 'Main', items: [it_('a', twelve('k')), it_('b')] }]);
    expect(reason(m.moveMenuItem(full, 'main', 'b', 'in'))).toBe('menu_item_limit');
    // b has a child and a grandchild (3 levels); under a level-1 sibling it would need 4.
    const deep = base([{ id: 'main', name: 'Main', items: [it_('a'), it_('b', [it_('b1', [it_('b2')])])] }]);
    expect(reason(m.moveMenuItem(deep, 'main', 'b', 'in'))).toBe('menu_depth');
    // b with one child level fits (a -> b -> b1 is 3 levels).
    const ok = base([{ id: 'main', name: 'Main', items: [it_('a'), it_('b', [it_('b1')])] }]);
    expect(m.moveMenuItem(ok, 'main', 'b', 'in').ok).toBe(true);
    // A level 2 item with a child cannot go under a level 2 sibling.
    const lvl2 = base([{ id: 'main', name: 'Main', items: [it_('t', [it_('a'), it_('b', [it_('b1')])])] }]);
    expect(reason(m.moveMenuItem(lvl2, 'main', 'b', 'in'))).toBe('menu_depth');
  });

  it('moveMenuItem in strips top-only fields and out does not bring them back', () => {
    const picture = { image: '/x.png', caption: 'c', link: '/l' };
    const t = base([
      {
        id: 'main',
        name: 'Main',
        items: [it_('a'), it_('b', undefined, { highlight: true, source: 'links', category_photos: true, picture })],
      },
    ]);
    const moved = m.moveMenuItem(t, 'main', 'b', 'in');
    if (!moved.ok) throw new Error('expected ok');
    const b = menuOf(moved, 'main').items[0].children![0];
    expect(b).toEqual({ id: 'b', label: 'B', link: '' });
    expect('highlight' in b || 'source' in b || 'category_photos' in b || 'picture' in b).toBe(false);
    const out = m.moveMenuItem(moved.theme, 'main', 'b', 'out');
    expect(menuOf(out, 'main').items).toEqual([{ id: 'a', label: 'A', link: '' }, { id: 'b', label: 'B', link: '' }]);
  });

  it('moveMenuItem out places the item right after its parent; top level and full level refuse', () => {
    const t = base([{ id: 'main', name: 'Main', items: [it_('a', [it_('a1'), it_('a2')]), it_('z')] }]);
    const r = m.moveMenuItem(t, 'main', 'a1', 'out');
    expect(menuOf(r, 'main').items.map((i) => i.id)).toEqual(['a', 'a1', 'z']);
    expect(menuOf(r, 'main').items[0].children!.map((i) => i.id)).toEqual(['a2']);
    expect(reason(m.moveMenuItem(t, 'main', 'z', 'out'))).toBe('not_found');
    const full = base([
      { id: 'main', name: 'Main', items: [it_('a', [it_('a1')]), ...Array.from({ length: 11 }, (_, i) => it_(`t${i}`))] },
    ]);
    expect(reason(m.moveMenuItem(full, 'main', 'a1', 'out'))).toBe('menu_item_limit');
    // Level 3 out lands on level 2 right after its parent.
    const deep = base([{ id: 'main', name: 'Main', items: [it_('a', [it_('b', [it_('c')]), it_('d')])] }]);
    const d = menuOf(m.moveMenuItem(deep, 'main', 'c', 'out'), 'main').items[0].children!;
    expect(d.map((i) => i.id)).toEqual(['b', 'c', 'd']);
  });

  it('reorderMenuItem moves within the level only', () => {
    const t = base([{ id: 'main', name: 'Main', items: [it_('a', [it_('a1'), it_('a2'), it_('a3')]), it_('b'), it_('c')] }]);
    expect(menuOf(m.reorderMenuItem(t, 'main', 'c', 0), 'main').items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    const sub = menuOf(m.reorderMenuItem(t, 'main', 'a1', 2), 'main');
    expect(sub.items[0].children!.map((i) => i.id)).toEqual(['a2', 'a3', 'a1']);
    expect(sub.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(reason(m.reorderMenuItem(t, 'main', 'zz', 0))).toBe('not_found');
    expect(reason(m.reorderMenuItem(t, 'main', 'a', 3))).toBe('not_found');
    expect(reason(m.reorderMenuItem(t, 'main', 'a', -1))).toBe('not_found');
  });

  it('duplicateMenuItem copies after the original with every id new and unique across the menu', () => {
    const t = base([
      { id: 'main', name: 'Main', items: [it_('a', [it_('a1', [it_('a11')]), it_('a2')], { highlight: true }), it_('z')] },
    ]);
    const r = m.duplicateMenuItem(t, 'main', 'a', mk());
    const menu = menuOf(r, 'main');
    expect(menu.items.map((i) => i.label)).toEqual(['A', 'A', 'Z']);
    const copy = menu.items[1];
    expect(copy.id).toBe(newIdOf(r));
    expect(copy.highlight).toBe(true);
    const all = ids(menu.items);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(9);
    expect(ids(copy.children!).some((id) => ['a1', 'a11', 'a2'].includes(id))).toBe(false);
    expect(copy.children![0].children![0].label).toBe('A11');
    // Duplicating a nested item stays at its level.
    const n = menuOf(m.duplicateMenuItem(t, 'main', 'a1', mk()), 'main').items[0].children!;
    expect(n.map((i) => i.label)).toEqual(['A1', 'A1', 'A2']);
  });

  it('duplicateMenuItem copes with a makeId that repeats and refuses a full level', () => {
    const t = base([{ id: 'main', name: 'Main', items: [it_('a', [it_('a1')])] }]);
    const r = m.duplicateMenuItem(t, 'main', 'a', () => 'same');
    const all = ids(menuOf(r, 'main').items);
    expect(new Set(all).size).toBe(all.length);
    const full = base([{ id: 'main', name: 'Main', items: twelve('i') }]);
    expect(reason(m.duplicateMenuItem(full, 'main', 'i0'))).toBe('menu_item_limit');
    expect(reason(m.duplicateMenuItem(t, 'main', 'zz'))).toBe('not_found');
  });

  it('removeMenuItem removes the item with its children', () => {
    const t = base([{ id: 'main', name: 'Main', items: [it_('a', [it_('a1')]), it_('b')] }]);
    expect(ids(menuOf(m.removeMenuItem(t, 'main', 'a'), 'main').items)).toEqual(['b']);
    expect(ids(menuOf(m.removeMenuItem(t, 'main', 'a1'), 'main').items)).toEqual(['a', 'b']);
    expect(reason(m.removeMenuItem(t, 'main', 'zz'))).toBe('not_found');
  });

  it('a refused op leaves the theme untouched', () => {
    const t = base([{ id: 'main', name: 'Main', items: [it_('a'), it_('b', [it_('b1', [it_('b2')])])] }]);
    const before = JSON.stringify(t);
    expect(m.moveMenuItem(t, 'main', 'b', 'in').ok).toBe(false);
    expect(JSON.stringify(t)).toBe(before);
  });
});

describe('menu ops purity', () => {
  const picture = { image: '/x.png', caption: 'c', link: '/l' };
  const theme = deepFreeze(
    base([
      { id: 'main', name: 'Main', items: [it_('a', [it_('a1', [it_('a11')])], { picture, highlight: true }), it_('b'), it_('c')] },
      { id: 'sale', name: 'Sale', items: [] },
    ]),
  );
  const cases: Array<[string, () => OpResult]> = [
    ['addMenu', () => m.addMenu(theme, 'x', mk())],
    ['renameMenu', () => m.renameMenu(theme, 'sale', 'y')],
    ['removeMenu', () => m.removeMenu(theme, 'sale')],
    ['addMenuItem', () => m.addMenuItem(theme, 'main', 'a', mk())],
    ['updateMenuItem', () => m.updateMenuItem(theme, 'main', 'a', { label: 'z', highlight: false })],
    ['moveMenuItem up', () => m.moveMenuItem(theme, 'main', 'b', 'up')],
    ['moveMenuItem down', () => m.moveMenuItem(theme, 'main', 'b', 'down')],
    ['moveMenuItem in', () => m.moveMenuItem(theme, 'main', 'b', 'in')],
    ['moveMenuItem out', () => m.moveMenuItem(theme, 'main', 'a1', 'out')],
    ['reorderMenuItem', () => m.reorderMenuItem(theme, 'main', 'c', 0)],
    ['duplicateMenuItem', () => m.duplicateMenuItem(theme, 'main', 'a', mk())],
    ['removeMenuItem', () => m.removeMenuItem(theme, 'main', 'a')],
  ];
  it.each(cases)('%s does not mutate its input', (_n, run) => {
    expect(() => run()).not.toThrow();
    expect(run().ok).toBe(true);
  });
  it('menuInUse does not throw on frozen input', () => {
    expect(() => m.menuInUse(theme, 'main')).not.toThrow();
  });
});
