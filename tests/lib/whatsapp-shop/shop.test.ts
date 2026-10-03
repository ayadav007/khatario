/**
 * WhatsApp shop: shop-request detection, cart normalisation, Meta payloads, signed image URLs and
 * order placement (catalogue prices only, never the cart's).
 */
const mockQuery = jest.fn();
const mockQueryOne = jest.fn();
const mockQueryRows = jest.fn();
const mockSettings = jest.fn();
const mockLoadItems = jest.fn();
const mockCreateOrder = jest.fn();
const mockUpdateState = jest.fn();
const mockPayLink = jest.fn();

jest.mock('@/lib/db', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  queryRows: (...a: unknown[]) => mockQueryRows(...a),
}));
jest.mock('@/lib/whatsapp-shop/settings', () => ({ getShopSettings: (...a: unknown[]) => mockSettings(...a) }));
jest.mock('@/lib/whatsapp-shop/items', () => ({
  ...jest.requireActual('@/lib/whatsapp-shop/items'),
  loadShopItems: (...a: unknown[]) => mockLoadItems(...a),
}));
jest.mock('@/lib/whatsapp-crm', () => ({
  createSalesOrderFromWhatsApp: (...a: unknown[]) => mockCreateOrder(...a),
  updateConversationState: (...a: unknown[]) => mockUpdateState(...a),
}));
jest.mock('@/lib/services/payment-service', () => ({
  generatePaymentLinkForBusiness: (...a: unknown[]) => mockPayLink(...a),
}));
jest.mock('@/lib/whatsapp/business-transport', () => ({ sendBusinessLink: jest.fn(), sendBusinessText: jest.fn() }));
jest.mock('@/lib/meta-whatsapp-credentials', () => ({ getMetaWaConfig: jest.fn() }));

import { buildCatalogMessagePayload, buildCtaUrlPayload } from '@/lib/meta-whatsapp';
import { isShopRequest } from '@/lib/whatsapp-shop/intent';
import { shopImageUrl, verifyShopImageSignature, type ShopItem } from '@/lib/whatsapp-shop/items';
import { normalizeShopLines, placeShopOrder, shopOrderReplyText, type PlacedShopOrder } from '@/lib/whatsapp-shop/order';
import { catalogProductData } from '@/lib/whatsapp-shop/sync';

const BIZ = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const item = (over: Partial<ShopItem> = {}): ShopItem => ({
  id: A,
  name: 'Radish Bunch',
  description: 'Fresh radishes',
  price: 20,
  mrp: null,
  unit: 'bunch',
  categoryName: 'Vegetables',
  inStock: true,
  imageSource: null,
  ...over,
});

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-at-least-16-chars';
  process.env.NEXT_PUBLIC_APP_URL = 'https://staging.khatario.com';
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.mockResolvedValue({ enabled: true, itemScope: 'all', hideOutOfStock: false });
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockQueryOne.mockResolvedValue(null);
  mockQueryRows.mockResolvedValue([]);
});

describe('isShopRequest', () => {
  it.each(['menu', 'Menu!', 'catalog', 'Hi! How can I order?', 'show me your products', 'price list pls', 'order now', 'hello shop'])(
    'treats "%s" as a shop request',
    (text) => expect(isShopRequest(text)).toBe(true),
  );

  it.each(['where is my order', 'what is the price of radish', 'is the shop open today?', 'cancel order', ''])(
    'leaves "%s" to the agent',
    (text) => expect(isShopRequest(text)).toBe(false),
  );
});

describe('normalizeShopLines', () => {
  it('merges repeats, drops bad ids and quantities, caps quantity', () => {
    expect(
      normalizeShopLines([
        { itemId: A, quantity: 2 },
        { itemId: A.toUpperCase(), quantity: 3 },
        { itemId: 'not-an-id', quantity: 1 },
        { itemId: B, quantity: 0 },
        { itemId: C, quantity: 5000 },
        { itemId: B, quantity: 1.9 },
      ]),
    ).toEqual([
      { itemId: A, quantity: 5 },
      { itemId: C, quantity: 999 },
      { itemId: B, quantity: 1 },
    ]);
  });
});

describe('Meta payloads', () => {
  it('builds a catalog message with a thumbnail product', () => {
    expect(buildCatalogMessagePayload({ body: 'Browse', thumbnailRetailerId: A })).toEqual({
      type: 'interactive',
      interactive: {
        type: 'catalog_message',
        body: { text: 'Browse' },
        action: { name: 'catalog_message', parameters: { thumbnail_product_retailer_id: A } },
      },
    });
  });

  it('clips the CTA button label to 20 characters', () => {
    const p = buildCtaUrlPayload({ body: 'Pay', buttonText: 'Pay now for your order today', url: 'https://x.test/p' }) as {
      interactive: { action: { parameters: { display_text: string; url: string } } };
    };
    expect(p.interactive.action.parameters.display_text).toHaveLength(20);
    expect(p.interactive.action.parameters.url).toBe('https://x.test/p');
  });

  it('gives Meta every required product field, priced from the selling price', () => {
    const data = catalogProductData(item({ mrp: 30, inStock: false }), { name: 'Green Valley', phone: null, storeBaseUrl: null }, 'https://img.test/a.jpg');
    expect(data).toEqual(
      expect.objectContaining({
        id: A,
        title: 'Radish Bunch',
        availability: 'out of stock',
        condition: 'new',
        price: '20.00 INR',
        image_link: 'https://img.test/a.jpg',
        brand: 'Green Valley',
        link: 'https://staging.khatario.com',
      }),
    );
    expect(String(data.description)).toContain('MRP ₹30');
  });
});

describe('shop image URLs', () => {
  it('passes absolute URLs through and makes relative ones absolute', () => {
    expect(shopImageUrl(item({ imageSource: 'https://cdn.test/a.png' }))).toBe('https://cdn.test/a.png');
    expect(shopImageUrl(item({ imageSource: '/uploads/a.png' }))).toBe('https://staging.khatario.com/uploads/a.png');
    expect(shopImageUrl(item({ imageSource: null }))).toBeNull();
  });

  it('signs inline images per item, and the signature does not open another item', () => {
    const url = shopImageUrl(item({ imageSource: 'data:image/png;base64,AAAA' }))!;
    const sig = new URL(url).searchParams.get('s');
    expect(url).toContain(`/api/public/wa-shop/image/${A}`);
    expect(verifyShopImageSignature(A, sig)).toBe(true);
    expect(verifyShopImageSignature(B, sig)).toBe(false);
    expect(verifyShopImageSignature(A, 'forged')).toBe(false);
  });
});

describe('placeShopOrder', () => {
  beforeEach(() => {
    mockLoadItems.mockResolvedValue([item({ id: A, price: 20 }), item({ id: B, name: 'Honey Ham', price: 99.5 })]);
    mockQueryRows.mockResolvedValue([{ name: 'Old Item' }]);
    mockCreateOrder.mockResolvedValue({ order_id: 'order-1', order_number: 'SO-INV-0007', total_amount: 139 });
    mockPayLink.mockResolvedValue({ link: 'https://rzp.io/l/abc', source: 'psp', provider: 'razorpay' });
  });

  it('prices from the catalogue, skips unknown items and returns the gateway link', async () => {
    const out = await placeShopOrder({
      businessId: BIZ,
      phone: '+91 98111 11111',
      conversationUuid: 'conv-1',
      lines: [
        { itemId: A, quantity: 2 },
        { itemId: B, quantity: 1 },
        { itemId: C, quantity: 4 },
      ],
    });
    expect(mockCreateOrder).toHaveBeenCalledWith(
      BIZ,
      [
        { item_id: A, name: 'Radish Bunch', quantity: 2, price: 20 },
        { item_id: B, name: 'Honey Ham', quantity: 1, price: 99.5 },
      ],
      '919811111111',
      undefined,
      'conv-1',
      undefined,
    );
    expect(mockUpdateState).toHaveBeenCalledWith(BIZ, '919811111111', 'waiting_payment', expect.objectContaining({ order_id: 'order-1' }));
    expect(out).toEqual(
      expect.objectContaining({ ok: true, orderNumber: 'SO-INV-0007', unavailable: ['Old Item'], paymentLink: 'https://rzp.io/l/abc', manualPayment: false }),
    );
    const cancel = mockQuery.mock.calls.find(([sql]) => String(sql).includes("SET status = 'cancelled'"));
    expect(cancel?.[1]).toEqual([BIZ, 'conv-1']);
  });

  it('refuses when the shop is off', async () => {
    mockSettings.mockResolvedValue({ enabled: false, itemScope: 'all', hideOutOfStock: false });
    const out = await placeShopOrder({ businessId: BIZ, phone: '919811111111', lines: [{ itemId: A, quantity: 1 }] });
    expect(out).toEqual({ ok: false, reason: 'SHOP_OFF', unavailable: [] });
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it('creates nothing when no cart item is sold any more', async () => {
    mockLoadItems.mockResolvedValue([]);
    const out = await placeShopOrder({ businessId: BIZ, phone: '919811111111', lines: [{ itemId: C, quantity: 1 }] });
    expect(out).toEqual({ ok: false, reason: 'NO_ITEMS', unavailable: ['Old Item'] });
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it('still places the order when the payment link fails', async () => {
    mockPayLink.mockRejectedValue(new Error('gateway down'));
    const out = (await placeShopOrder({ businessId: BIZ, phone: '919811111111', lines: [{ itemId: A, quantity: 1 }] })) as PlacedShopOrder;
    expect(out.ok).toBe(true);
    expect(out.paymentLink).toBeNull();
    expect(shopOrderReplyText(out)).toContain("We'll share the payment details");
  });
});

describe('shopOrderReplyText', () => {
  it('lists lines, total and the screenshot step for manual payment', () => {
    const text = shopOrderReplyText({
      ok: true,
      orderId: 'o',
      orderNumber: 'SO-1',
      total: 49.5,
      lines: [{ name: 'Radish', quantity: 2, price: 24.75, lineTotal: 49.5 }],
      unavailable: [],
      paymentLink: 'https://staging.khatario.com/pay/upi/x',
      manualPayment: true,
    });
    expect(text).toContain('Order SO-1 received');
    expect(text).toContain('1. Radish × 2 = ₹49.50');
    expect(text).toContain('Total: ₹49.50');
    expect(text).toContain('screenshot');
  });
});
