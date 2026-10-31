import { sanitizeMenus } from '@/lib/store/engine/menus-sanitize';
import { ENGINE_LIMITS } from '@/lib/store/engine/shared';

const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: `Label ${id}`, link: '', ...extra });

describe('sanitizeMenus', () => {
  it('keeps a valid three-level menu', () => {
    const menus = [
      {
        id: 'main',
        name: 'Main menu',
        items: [
          item('a', {
            link: '/catalog',
            highlight: true,
            children: [item('b', { link: '/x', children: [item('c', { link: 'https://example.com/y' })] })],
          }),
        ],
      },
    ];
    expect(sanitizeMenus(menus)).toEqual(menus);
  });

  it('drops a fourth level', () => {
    const out = sanitizeMenus([
      { id: 'm', name: 'M', items: [item('a', { children: [item('b', { children: [item('c', { children: [item('d')] })] })] })] },
    ]);
    const c = out[0].items[0].children![0].children![0];
    expect(c.id).toBe('c');
    expect(c.children).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('"d"');
  });

  it('drops top-only fields below the top', () => {
    const out = sanitizeMenus([
      {
        id: 'm',
        name: 'M',
        items: [
          item('a', {
            children: [
              item('b', {
                highlight: true,
                source: 'categories',
                category_photos: true,
                picture: { image: 'https://example.com/p.jpg', caption: 'Hi', link: '/x' },
                children: [item('c', { highlight: true, source: 'links', category_photos: false })],
              }),
            ],
          }),
        ],
      },
    ]);
    const b = out[0].items[0].children![0];
    for (const k of ['highlight', 'source', 'category_photos', 'picture']) expect(b).not.toHaveProperty(k);
    const c = b.children![0];
    for (const k of ['highlight', 'source', 'category_photos', 'picture']) expect(c).not.toHaveProperty(k);
  });

  it('keeps top-only fields at the top', () => {
    const out = sanitizeMenus([
      {
        id: 'm',
        name: 'M',
        items: [
          item('a', { source: 'categories', category_photos: true }),
          item('b', { source: 'bogus', category_photos: 'yes', highlight: 'x' }),
        ],
      },
    ]);
    expect(out[0].items[0]).toMatchObject({ source: 'categories', category_photos: true });
    expect(out[0].items[1]).not.toHaveProperty('source');
    expect(out[0].items[1]).not.toHaveProperty('category_photos');
    expect(out[0].items[1]).not.toHaveProperty('highlight');
  });

  it('clips labels and names by characters', () => {
    const emoji = '🛍️'.repeat(30);
    const out = sanitizeMenus([{ id: 'm', name: emoji, items: [item('a', { label: emoji })] }]);
    for (const s of [out[0].name, out[0].items[0].label]) {
      expect(Array.from(s).length).toBeLessThanOrEqual(40);
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(s)).toBe(false);
      expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)).toBe(false);
    }
  });

  it('drops items with an empty label, a bad or duplicate id', () => {
    const out = sanitizeMenus([
      {
        id: 'm',
        name: 'M',
        items: [
          item('ok'),
          item('empty', { label: '   ' }),
          item('Bad Id'),
          item('ok'),
          item('__proto__'),
          { id: 'nolabel', link: '' },
          item('nested', { children: [item('ok'), item('kid')] }),
        ],
      },
    ]);
    expect(out[0].items.map((i) => i.id)).toEqual(['ok', 'nested']);
    expect(out[0].items[1].children!.map((i) => i.id)).toEqual(['kid']);
  });

  it('drops menus with a bad or duplicate id', () => {
    const out = sanitizeMenus([
      { id: 'a', name: 'A', items: [] },
      { id: 'a', name: 'Again', items: [] },
      { id: 'Bad id', name: 'B', items: [] },
      { id: 'b', name: 'B', items: [] },
    ]);
    expect(out.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('names an empty menu name Menu', () => {
    expect(sanitizeMenus([{ id: 'a', name: '   ', items: [] }, { id: 'b', items: [] }]).map((m) => m.name)).toEqual(['Menu', 'Menu']);
  });

  it('drops menus over 10 and items over 12 per level', () => {
    const menus = Array.from({ length: 15 }, (_, i) => ({
      id: `m${i}`,
      name: `M${i}`,
      items: Array.from({ length: 20 }, (_, j) => item(`i${j}`, { children: Array.from({ length: 20 }, (_, k) => item(`c${k}`)) })),
    }));
    const out = sanitizeMenus(menus);
    expect(out).toHaveLength(ENGINE_LIMITS.menus.menus);
    expect(out[0].items).toHaveLength(ENGINE_LIMITS.menus.itemsPerLevel);
    expect(out[0].items[0].children).toHaveLength(ENGINE_LIMITS.menus.itemsPerLevel);
  });

  it('cleans links and pictures', () => {
    const out = sanitizeMenus([
      {
        id: 'm',
        name: 'M',
        items: [
          item('a', { link: 'javascript:alert(1)' }),
          item('b', { picture: { image: 'javascript:alert(1)', caption: 'x', link: '/y' } }),
          item('c', { picture: { image: 'https://example.com/p.jpg', caption: 'c'.repeat(100), link: 'javascript:alert(1)' } }),
          item('d', { picture: 'nope' }),
        ],
      },
    ]);
    const [a, b, c, d] = out[0].items;
    expect(a.link).toBe('');
    expect(b).not.toHaveProperty('picture');
    expect(c.picture).toEqual({ image: 'https://example.com/p.jpg', caption: 'c'.repeat(60), link: '' });
    expect(d).not.toHaveProperty('picture');
  });

  it('source categories drops children', () => {
    const out = sanitizeMenus([{ id: 'm', name: 'M', items: [item('a', { source: 'categories', children: [item('b')] })] }]);
    expect(out[0].items[0].source).toBe('categories');
    expect(out[0].items[0]).not.toHaveProperty('children');
  });

  it('drops unknown keys and empty children arrays', () => {
    const out = sanitizeMenus([{ id: 'm', name: 'M', extra: 1, items: [item('a', { evil: 'x', children: [] })] }]);
    expect(out[0]).toEqual({ id: 'm', name: 'M', items: [{ id: 'a', label: 'Label a', link: '' }] });
  });

  it('non-array input gives []', () => {
    for (const v of [undefined, null, 'x', 5, {}, { 0: { id: 'a' } }]) expect(sanitizeMenus(v)).toEqual([]);
  });
});
