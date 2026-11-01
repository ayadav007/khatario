import { collageMode, collageTiles } from '@/lib/store/engine/collage-map';
import type { StoreItem } from '@/lib/store/map-store-product';
import type { Block, Section } from '@/lib/store/engine/types';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const blk = (type: string, settings: Record<string, unknown>, disabled = false): Block => ({ type, settings, ...(disabled ? { disabled: true } : {}) });
function sec(type: string, settings: Record<string, unknown>, blocks: Block[]): Section {
  const entries = blocks.map((b, i) => [`b${i}`, b] as const);
  return { type, settings, blocks: Object.fromEntries(entries), block_order: entries.map(([id]) => id) };
}
const item = (id: string, over: Partial<StoreItem> = {}) => ({ id, name: `Item ${id.slice(0, 2)}`, selling_price: 1000, image_url: '/p.webp', images: [], ...over }) as unknown as StoreItem;
const itemA = item(A);
const read = (b: Block) => ({ ...b.settings });

describe('collageTiles', () => {
  it('maps the three tile kinds and drops the unresolvable ones', () => {
    const data = { productsById: { [A]: itemA }, categories: [{ id: C, name: 'Sarees', item_count: 3, image_url: '/c.webp' }] };
    const tiles = collageTiles(
      sec('collage', {}, [
        blk('image_tile', { image: '/x.webp', caption: 'Kashi', label: '₹1,85,000' }),
        blk('product_tile', { product: A }),
        blk('product_tile', { product: B }),
        blk('category_tile', { category: C, image: '/override.webp' }),
        blk('image_tile', {}),
      ]),
      data,
      read,
    );
    expect(tiles.map((t) => t.kind)).toEqual(['image', 'product', 'category']);
    expect(tiles[0]).toMatchObject({ kind: 'image', image: '/x.webp', video: false, caption: 'Kashi', label: '₹1,85,000', link: '' });
    expect(tiles[1]).toMatchObject({ kind: 'product', product: itemA, image: '/p.webp' });
    expect(tiles[2]).toMatchObject({ kind: 'category', categoryId: C, name: 'Sarees', image: '/override.webp' });
  });

  it('a product or category image override wins; without one the product photo or category image shows', () => {
    const data = { productsById: { [A]: itemA }, categories: [{ id: C, name: 'Sarees', item_count: 3, image_url: '/c.webp' }] };
    const tiles = collageTiles(
      sec('collage', {}, [blk('product_tile', { product: A, image: '/mine.webp' }), blk('category_tile', { category: C })]),
      data,
      read,
    );
    expect(tiles.map((t) => (t.kind === 'image' ? '' : t.image))).toEqual(['/mine.webp', '/c.webp']);
  });

  it('falls back to the first gallery photo when a product has no main image', () => {
    const p = item(A, { image_url: null, images: ['/g1.webp'] });
    const tiles = collageTiles(sec('collage', {}, [blk('product_tile', { product: A })]), { productsById: { [A]: p } }, read);
    expect(tiles[0]).toMatchObject({ kind: 'product', image: '/g1.webp' });
  });

  it('flags a video tile', () => {
    const tiles = collageTiles(sec('collage', {}, [blk('image_tile', { image: '/loop.mp4' }), blk('image_tile', { image: '/a.webp' })]), {}, read);
    expect(tiles.map((t) => t.kind === 'image' && t.video)).toEqual([true, false]);
  });

  it('skips disabled blocks, unknown block types, and blocks whose settings cannot be read', () => {
    const section = sec('collage', {}, [
      blk('image_tile', { image: '/a.webp' }, true),
      blk('mystery', { image: '/b.webp' }),
      blk('image_tile', { image: '/c.webp' }),
    ]);
    const tiles = collageTiles(section, {}, (b) => (b.type === 'mystery' ? null : read(b)));
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ image: '/c.webp' });
  });

  it('works with no section data at all (no products, no categories)', () => {
    const tiles = collageTiles(sec('collage', {}, [blk('product_tile', { product: A }), blk('category_tile', { category: C }), blk('image_tile', { image: '/a.webp' })]), {}, read);
    expect(tiles.map((t) => t.kind)).toEqual(['image']);
  });
});

describe('collageMode', () => {
  it('a text layout with no tiles still shows the text; a tiles layout with none is empty', () => {
    expect(collageMode('text-left', 0)).toBe('text');
    expect(collageMode('text-right', 2)).toBe('text+tiles');
    expect(collageMode('text-left', 1)).toBe('text+tiles');
    expect(collageMode('tiles', 0)).toBe('empty');
    expect(collageMode('tiles', 3)).toBe('tiles');
  });

  it('treats an unknown layout as a text layout', () => {
    expect(collageMode('bogus', 0)).toBe('text');
    expect(collageMode('bogus', 2)).toBe('text+tiles');
  });
});
