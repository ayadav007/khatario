jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: jest.fn(), getPool: jest.fn() }));
jest.mock('@/lib/store/notify-whatsapp', () => ({ notifyStoreEvent: jest.fn() }));
jest.mock('@/lib/push/customer-push', () => ({ enqueueCustomerPush: jest.fn() }));

import { mergeCarts, type CartLine } from '@/lib/store/abandoned-carts';
import {
  cartSignature,
  cartSyncEnabled,
  mergeServerCart,
  shouldPutCart,
  toSyncLines,
  type ServerCartLine,
} from '@/lib/store/cart-sync';
import type { StoreCartItem } from '@/lib/store/store-context';

const local = (itemId: string, quantity: number, variantId?: string): StoreCartItem => ({
  itemId,
  variantId,
  name: `Local ${itemId}`,
  price: 10,
  quantity,
  unit: 'KG',
  maxStock: 50,
});

const server = (item_id: string, quantity: number, variant_id: string | null = null): ServerCartLine => ({
  item_id,
  variant_id,
  quantity,
  price: 99,
  name: variant_id ? `Server ${item_id} – Big` : `Server ${item_id}`,
  image_url: 'https://img.example/x.jpg',
  item_name: `Server ${item_id}`,
  variant_name: variant_id ? 'Big' : null,
  unit: 'PCS',
  stock: 7,
});

describe('cart sync mapping', () => {
  test('toSyncLines sends only item, variant and quantity', () => {
    expect(toSyncLines([local('a', 2), local('b', 1, 'v1')])).toEqual([
      { item_id: 'a', variant_id: null, quantity: 2 },
      { item_id: 'b', variant_id: 'v1', quantity: 1 },
    ]);
  });

  test('server quantity wins and keeps local details; order matches mergeCarts', () => {
    const l = [local('a', 1), local('c', 4), local('b', 2, 'v1')];
    const s = [server('b', 5, 'v1'), server('d', 3)];
    const merged = mergeServerCart(l, s);
    expect(merged.map((c) => [c.itemId, c.variantId ?? null, c.quantity])).toEqual([
      ['b', 'v1', 5],
      ['d', null, 3],
      ['a', null, 1],
      ['c', null, 4],
    ]);
    // Same keys and quantities as the server-side rule.
    const asLine = (c: StoreCartItem): CartLine => ({
      item_id: c.itemId,
      variant_id: c.variantId ?? null,
      quantity: c.quantity,
      price: c.price,
      name: c.name,
      image_url: null,
    });
    expect(merged.map((c) => [c.itemId, c.variantId ?? null, c.quantity])).toEqual(
      mergeCarts(l.map(asLine), s).map((c) => [c.item_id, c.variant_id, c.quantity]),
    );
    expect(merged[0]).toMatchObject({ name: 'Local b', unit: 'KG', price: 10 });
  });

  test('a line only on the server is shown with its name, price, image and unit', () => {
    const [line] = mergeServerCart([], [server('d', 3, 'v9')]);
    expect(line).toEqual({
      itemId: 'd',
      variantId: 'v9',
      name: 'Server d',
      variantName: 'Big',
      price: 99,
      quantity: 3,
      imageUrl: 'https://img.example/x.jpg',
      unit: 'PCS',
      maxStock: 7,
    });
  });

  test('a bare saved line falls back to its combined name and never caps below its quantity', () => {
    const bare: ServerCartLine = { item_id: 'e', variant_id: null, quantity: 4, price: 5, name: 'Rice – 5 kg', image_url: null };
    expect(mergeServerCart([], [bare])[0]).toMatchObject({
      name: 'Rice – 5 kg',
      variantName: undefined,
      imageUrl: undefined,
      unit: 'PCS',
      maxStock: 4,
    });
  });

  test('cartSignature changes only when what a PUT sends changes', () => {
    const a = [local('a', 1)];
    expect(cartSignature(a)).toBe(cartSignature([{ ...local('a', 1), price: 999, name: 'x' }]));
    expect(cartSignature(a)).not.toBe(cartSignature([local('a', 2)]));
  });
});

describe('when to sync', () => {
  const on = { customerId: 'c1', storeLoaded: true, isDemo: false, draft: false };
  test('only for a signed-in shopper on a loaded, real store outside a draft preview', () => {
    expect(cartSyncEnabled(on)).toBe(true);
    expect(cartSyncEnabled({ ...on, customerId: null })).toBe(false);
    expect(cartSyncEnabled({ ...on, storeLoaded: false })).toBe(false);
    expect(cartSyncEnabled({ ...on, isDemo: true })).toBe(false);
    expect(cartSyncEnabled({ ...on, draft: true })).toBe(false);
  });

  const put = { enabled: true, customerId: 'c1', mergedFor: 'c1', merging: false, signature: 's2', lastSent: 's1' };
  test('PUT only after the sign-in merge for this shopper and when the cart changed', () => {
    expect(shouldPutCart(put)).toBe(true);
    expect(shouldPutCart({ ...put, enabled: false })).toBe(false);
    expect(shouldPutCart({ ...put, customerId: null })).toBe(false);
    expect(shouldPutCart({ ...put, mergedFor: null })).toBe(false);
    expect(shouldPutCart({ ...put, mergedFor: 'other' })).toBe(false);
    expect(shouldPutCart({ ...put, merging: true })).toBe(false);
    expect(shouldPutCart({ ...put, lastSent: 's2' })).toBe(false);
  });
});
