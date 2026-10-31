import { lookTotal, shopTheLookItems, type LookItem } from '@/lib/store/engine/shop-the-look-map';
import type { StoreItem } from '@/lib/store/map-store-product';
import type { Block, Section } from '@/lib/store/engine/types';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const MISSING = '99999999-9999-4999-8999-999999999999';

const blk = (type: string, settings: Record<string, unknown>, disabled = false): Block => ({ type, settings, ...(disabled ? { disabled: true } : {}) });
function sec(type: string, settings: Record<string, unknown>, blocks: Block[]): Section {
  const entries = blocks.map((b, i) => [`b${i}`, b] as const);
  return { type, settings, blocks: Object.fromEntries(entries), block_order: entries.map(([id]) => id) };
}
const item = (id: string, over: Partial<StoreItem> = {}) =>
  ({ id, name: `Item ${id.slice(0, 2)}`, selling_price: 1000, current_stock: 5, has_variants: false, image_url: '/p.webp', images: [], ...over }) as unknown as StoreItem;
const itemA = item(A);
const itemB = item(B);
const read = (b: Block) => ({ ...b.settings });
const base: LookItem = { id: 'x', n: 1, x: 50, y: 50, label: 'L', product: itemA, soldOut: false, hasOptions: false };

describe('shopTheLookItems', () => {
  it('numbers resolvable hotspots in order, clamps positions, marks sold out and options', () => {
    const data = { productsById: { [A]: { ...itemA, current_stock: 0 }, [B]: { ...itemB, has_variants: true } } };
    const items = shopTheLookItems(
      sec('shop-the-look', {}, [blk('hotspot', { product: MISSING, x: 10, y: 10 }), blk('hotspot', { product: A, x: 130, y: -5 }), blk('hotspot', { product: B, label: 'Choker' })]),
      data,
      read,
    );
    expect(items.map((i) => [i.n, i.x, i.y])).toEqual([[1, 100, 0], [2, 50, 50]]);
    expect(items[0]).toMatchObject({ soldOut: true, label: itemA.name });
    expect(items[1]).toMatchObject({ hasOptions: true, label: 'Choker' });
  });

  it('a product with options is not sold out even at zero stock', () => {
    const data = { productsById: { [A]: { ...itemA, current_stock: 0, has_variants: true } } };
    const [i] = shopTheLookItems(sec('shop-the-look', {}, [blk('hotspot', { product: A })]), data, read);
    expect(i).toMatchObject({ soldOut: false, hasOptions: true });
  });

  it('skips disabled and unreadable blocks, other block types, and a failed product lookup', () => {
    const data = { productsById: { [A]: itemA } };
    const s = sec('shop-the-look', {}, [blk('hotspot', { product: A }, true), blk('other', { product: A }), blk('hotspot', { product: A })]);
    expect(shopTheLookItems(s, data, read)).toHaveLength(1);
    expect(shopTheLookItems(s, data, () => null)).toEqual([]);
    expect(shopTheLookItems(s, { productsById: {}, productsFailed: true }, read)).toEqual([]);
    expect(shopTheLookItems(s, {}, read)).toEqual([]);
  });

  it('non-numeric positions fall back to the centre', () => {
    const data = { productsById: { [A]: itemA } };
    const [i] = shopTheLookItems(sec('shop-the-look', {}, [blk('hotspot', { product: A, x: 'left', y: '70' })]), data, read);
    expect([i.x, i.y]).toEqual([50, 70]);
  });
});

describe('lookTotal', () => {
  it('sums only items that can be added', () => {
    expect(
      lookTotal([
        { ...base, soldOut: true, product: { ...itemA, selling_price: 100 } },
        { ...base, product: { ...itemB, selling_price: 250 } },
        { ...base, hasOptions: true, product: { ...itemB, selling_price: 999 } },
      ]),
    ).toBe(250);
  });
});
