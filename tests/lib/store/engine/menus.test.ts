import { foldMenu, menuFooterColumns, menuItemKind, pickMenu, resolveMenu } from '@/lib/store/engine/menus';
import type { Menu, MenuItem } from '@/lib/store/engine/types';

const item = (id: string, extra: Partial<MenuItem> = {}): MenuItem => ({ id, label: `Label ${id}`, link: '', ...extra });
const menu = (id: string, items: MenuItem[]): Menu => ({ id, name: id, items });
const cat = (id: string, name = id) => ({ id, name, image_url: null });

describe('menuItemKind', () => {
  it('is link without children', () => {
    expect(menuItemKind(item('a'))).toBe('link');
    expect(menuItemKind(item('a', { children: [] }))).toBe('link');
  });
  it('is dropdown when children have no children', () => {
    expect(menuItemKind(item('a', { children: [item('b'), item('c')] }))).toBe('dropdown');
  });
  it('is mega when any child has children', () => {
    expect(menuItemKind(item('a', { children: [item('b'), item('c', { children: [item('d')] })] }))).toBe('mega');
  });
  it('is categories for the automatic source', () => {
    expect(menuItemKind(item('a', { source: 'categories', children: [item('b')] }))).toBe('categories');
  });
});

describe('resolveMenu', () => {
  it('returns nothing for no menu', () => {
    expect(resolveMenu(null, [])).toEqual([]);
  });

  it('hides links to deleted categories, keeps them when the lookup failed', () => {
    const m = menu('main', [item('a', { link: '/catalog/veg' }), item('b', { link: '/catalog/gone' }), item('c', { link: '/about' })]);
    expect(resolveMenu(m, [cat('veg')]).map((i) => i.id)).toEqual(['a', 'c']);
    expect(resolveMenu(m, null).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('decodes encoded ids and ignores query and hash', () => {
    const m = menu('main', [item('a', { link: `/catalog/${encodeURIComponent('a b/c')}?sort=1` }), item('b', { link: '/catalog/x#top' })]);
    expect(resolveMenu(m, [cat('a b/c')]).map((i) => i.id)).toEqual(['a']);
  });

  it('a dropdown whose children are all hidden becomes a link', () => {
    const m = menu('main', [item('a', { link: '/shop', children: [item('b', { link: '/catalog/gone' })] })]);
    const [a] = resolveMenu(m, [cat('veg')]);
    expect(a.kind).toBe('link');
    expect(a.children).toEqual([]);
    expect(a.href).toBe('/shop');
  });

  it('a mega item whose groups lost all grandchildren becomes a dropdown', () => {
    const m = menu('main', [
      item('a', { children: [item('g', { link: '/g', children: [item('l', { link: '/catalog/gone' })] })] }),
    ]);
    const [a] = resolveMenu(m, [cat('veg')]);
    expect(a.kind).toBe('dropdown');
    expect(a.children[0].kind).toBe('link');
  });

  it('keeps a heading without a link when only its own category link is gone but links remain', () => {
    const m = menu('main', [item('a', { children: [item('g', { link: '/catalog/gone', children: [item('l', { link: '/x' })] })] })]);
    const [a] = resolveMenu(m, [cat('veg')]);
    expect(a.kind).toBe('mega');
    expect(a.children[0].href).toBe('');
  });

  it('categories item lists the categories', () => {
    const m = menu('main', [item('all', { label: 'Shop', source: 'categories', category_photos: true })]);
    const [a] = resolveMenu(m, [cat('x'), cat('y')]);
    expect(a.kind).toBe('categories');
    expect(a.categories?.length).toBe(2);
    expect(a.href).toBe('/catalog');
    expect(a.categoryPhotos).toBe(true);
    expect(a.children).toEqual([]);
  });

  it('categories item keeps its own link', () => {
    const m = menu('main', [item('all', { link: '/catalog?x=1', source: 'categories' })]);
    expect(resolveMenu(m, [cat('x')])[0].href).toBe('/catalog?x=1');
  });

  it('categories item is a plain link to /catalog with no categories or a failed lookup', () => {
    const m = menu('main', [item('all', { source: 'categories', children: [item('z')] })]);
    for (const cats of [[], null]) {
      const [a] = resolveMenu(m, cats);
      expect(a.kind).toBe('link');
      expect(a.href).toBe('/catalog');
      expect(a.children).toEqual([]);
      expect(a.categories).toBeUndefined();
    }
  });

  it('defaults flags and copies the picture for top items only', () => {
    const picture = { image: 'https://x/y.png', caption: 'c', link: '/p' };
    const m = menu('main', [
      item('a', { highlight: true, picture, children: [item('b', { picture, highlight: true })] }),
      item('z'),
    ]);
    const [a, z] = resolveMenu(m, []);
    expect(a.highlight).toBe(true);
    expect(a.picture).toEqual(picture);
    expect(a.children[0].picture).toBeUndefined();
    expect(a.children[0].highlight).toBe(false);
    expect(z.highlight).toBe(false);
    expect(z.categoryPhotos).toBe(false);
    expect(z.picture).toBeUndefined();
  });
});

describe('pickMenu', () => {
  const menus = [menu('main', []), menu('footer', []), menu('promo', [])];
  it('picks the chosen menu', () => expect(pickMenu(menus, 'promo', 'main')?.id).toBe('promo'));
  it('falls back to the default id', () => {
    expect(pickMenu(menus, 'gone', 'main')?.id).toBe('main');
    expect(pickMenu(menus, undefined, 'footer')?.id).toBe('footer');
    expect(pickMenu(menus, 5, 'footer')?.id).toBe('footer');
  });
  it('returns null when neither exists', () => {
    expect(pickMenu([menu('promo', [])], 'gone', 'main')).toBeNull();
    expect(pickMenu([], 'main', 'main')).toBeNull();
  });
});

describe('menuFooterColumns', () => {
  it('flattens level 3 under the group', () => {
    const m = menu('footer', [
      item('shop', {
        label: 'Shop',
        link: '/catalog',
        children: [
          item('g1', { label: 'Veg', link: '/v', children: [item('l1', { label: 'Onion', link: '/o' }), item('l2', { label: 'Tomato', link: '/t' })] }),
          item('g2', { label: 'Fruit', link: '/f' }),
        ],
      }),
      item('help', { label: 'Help' }),
    ]);
    expect(menuFooterColumns(resolveMenu(m, null))).toEqual([
      {
        heading: 'Shop',
        href: '/catalog',
        links: [
          { label: 'Veg', href: '/v' },
          { label: 'Onion', href: '/o' },
          { label: 'Tomato', href: '/t' },
          { label: 'Fruit', href: '/f' },
        ],
      },
      { heading: 'Help', href: '', links: [] },
    ]);
  });
});

describe('foldMenu', () => {
  it('keeps all items when they fit', () => expect(foldMenu([100, 100, 100], 400, 60)).toBe(3));
  it('keeps what fits beside More', () => expect(foldMenu([100, 100, 100], 250, 60)).toBe(1));
  it('can fold everything', () => expect(foldMenu([300], 100, 60)).toBe(0));
  it('handles no items', () => expect(foldMenu([], 0, 60)).toBe(0));
});
