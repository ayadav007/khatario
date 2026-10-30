jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: jest.fn(), getPool: jest.fn() }));
jest.mock('@/lib/store/notify-whatsapp', () => ({ notifyStoreEvent: jest.fn() }));
jest.mock('@/lib/push/customer-push', () => ({ enqueueCustomerPush: jest.fn() }));

import {
  canRemindManually,
  cartLink,
  cartPushBody,
  cartReminderMessage,
  cartSubtotal,
  mergeCarts,
  saveCart,
  type CartLine,
} from '@/lib/store/abandoned-carts';

const line = (item_id: string, quantity: number, price = 100, variant_id: string | null = null): CartLine => ({
  item_id,
  variant_id,
  quantity,
  price,
  name: `Item ${item_id}`,
  image_url: null,
});

describe('mergeCarts', () => {
  test('keeps the server quantity and appends a new local line', () => {
    const server = [line('a', 2), line('b', 1)];
    const local = [line('a', 5), line('c', 3)];
    expect(mergeCarts(local, server).map((l) => [l.item_id, l.quantity])).toEqual([
      ['a', 2],
      ['b', 1],
      ['c', 3],
    ]);
  });

  test('treats variants of one item as separate lines', () => {
    const server = [line('a', 1, 100, 'v1')];
    const local = [line('a', 4, 100, 'v2'), line('a', 9, 100, 'v1')];
    expect(mergeCarts(local, server).map((l) => [l.variant_id, l.quantity])).toEqual([
      ['v1', 1],
      ['v2', 4],
    ]);
  });
});

describe('cartSubtotal', () => {
  test('sums price times quantity rounded to paise', () => {
    expect(cartSubtotal([line('a', 3, 33.333), line('b', 1, 0.1)])).toBe(100.1);
    expect(cartSubtotal([line('a', 2, 0.1), line('b', 1, 0.2)])).toBe(0.4);
    expect(cartSubtotal([])).toBe(0);
  });
});

describe('cartReminderMessage', () => {
  test('caps names at three and counts the rest', () => {
    const lines = ['A', 'B', 'C', 'D', 'E'].map((n) => ({ ...line(n, 1), name: n }));
    expect(cartReminderMessage(lines, { name: 'Sharma Store' }, 1250)).toEqual({
      item_names: 'A, B, C and 2 more',
      total: '1,250.00',
    });
  });

  test('lists up to three names without a tail', () => {
    const lines = ['Rice', 'Ghee'].map((n) => ({ ...line(n, 1), name: n }));
    expect(cartReminderMessage(lines, { name: 'S' }, 99.5).item_names).toBe('Rice, Ghee');
  });
});

describe('canRemindManually', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  test('allowed when never reminded', () => {
    expect(canRemindManually(null, now)).toBe(true);
  });
  test('refused at 23 hours, allowed at 24', () => {
    expect(canRemindManually(new Date(now.getTime() - 23 * 3600_000), now)).toBe(false);
    expect(canRemindManually(new Date(now.getTime() - 24 * 3600_000), now)).toBe(true);
  });
});

describe('cartPushBody', () => {
  test('agrees with one item or many', () => {
    const named = (names: string[]) => names.map((n) => ({ ...line(n, 1), name: n }));
    expect(cartPushBody(named(['Rice']), 'Sharma Store', 100)).toBe(
      'Rice is still in your cart at Sharma Store. Total ₹100.00.',
    );
    expect(cartPushBody(named(['Rice', 'Ghee', 'Atta', 'Salt']), 'S', 1250)).toBe(
      'Rice, Ghee, Atta and 1 more are still in your cart at S. Total ₹1,250.00.',
    );
  });
});

describe('saveCart line validation', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const ok = (): CartLine => ({ ...line(id, 1, 100), name: 'Rice' });
  const bad: [string, Partial<Record<keyof CartLine, unknown>>][] = [
    ['NaN price', { price: NaN }],
    ['negative price', { price: -1 }],
    ['Infinity price', { price: Infinity }],
    ['too large price', { price: 10_000_001 }],
    ['non-string name', { name: 42 }],
    ['blank name', { name: '   ' }],
    ['bad item uuid', { item_id: 'not-a-uuid' }],
    ['bad variant uuid', { variant_id: 'x' }],
    ['non-string image', { image_url: 5 }],
  ];
  test.each(bad)('rejects %s as bad_line', async (_label, patch) => {
    await expect(saveCart(id, id, [{ ...ok(), ...patch } as CartLine])).rejects.toMatchObject({ code: 'bad_line' });
  });
  test('rejects a subtotal past the column limit', async () => {
    const lines = Array.from({ length: 2 }, () => ({ ...ok(), price: 9_000_000, quantity: 999 }));
    await expect(saveCart(id, id, lines)).rejects.toMatchObject({ code: 'bad_line' });
  });
});

describe('cartLink', () => {
  const prev = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = prev;
  });
  test('builds the store cart URL on the app host suffix', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.khatario.com';
    expect(cartLink('sharma')).toBe('https://sharma.staging.khatario.com/cart');
    process.env.NEXT_PUBLIC_APP_URL = 'https://khatario.com/';
    expect(cartLink('sharma')).toBe('https://sharma.khatario.com/cart');
  });
});
