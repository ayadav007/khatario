/**
 * Customer bot on a business's own WhatsApp: shop catalog/policy sources, strict per-business
 * isolation, order status only for the sender's own number, the daily reply cap and Cloud replies.
 */
const mockQuery = jest.fn();
const mockQueryOne = jest.fn();
const mockQueryRows = jest.fn();
const mockRetrieve = jest.fn();
const mockScheduleTenant = jest.fn();
const mockIndexSource = jest.fn();

jest.mock('@/lib/db', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  queryRows: (...a: unknown[]) => mockQueryRows(...a),
  getPool: jest.fn(),
}));
jest.mock('@/lib/rag/retrieve', () => ({
  ...jest.requireActual('@/lib/rag/retrieve'),
  retrieve: (...a: unknown[]) => mockRetrieve(...a),
}));
jest.mock('@/lib/rag/queue', () => ({ scheduleTenantReindex: (...a: unknown[]) => mockScheduleTenant(...a) }));
jest.mock('@/lib/meta-whatsapp', () => ({ getMetaWaConfig: jest.fn().mockResolvedValue(null), sendTemplateMessage: jest.fn(), sendTextMessage: jest.fn() }));

import { scopeFilter } from '@/lib/rag/retrieve';
import {
  buildPolicyDocuments,
  catalogItemDocument,
  deliveryMarkdown,
  stockBand,
  type CatalogItemRow,
  type PolicyRow,
} from '@/lib/rag/ingest/tenant-sources';
import { removeStaleTenantSources } from '@/lib/rag/ingest/indexer';
import {
  customerBotAllowed,
  formatOrderStatus,
  looksLikeOrderQuestion,
  orderStatusContext,
  shopKnowledgeContext,
} from '@/lib/whatsapp/customer-bot';
import { cloudReplyText } from '@/lib/whatsapp/cloud-incoming';

const BIZ_A = '11111111-1111-4111-8111-111111111111';
const BIZ_B = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rowCount: 1 });
});

describe('catalog source', () => {
  const item: CatalogItemRow = {
    id: 'i1', name: 'Coconut Hair Oil', code: 'HO-1', description: 'Cold pressed.', selling_price: '249.00', mrp: '299',
    unit: 'BTL', current_stock: '3', item_type: 'goods', category: 'Hair care',
    variants: [{ name: '500 ml', price: '449', stock: 0 }],
  };

  it('shows price, MRP and a stock band but never the exact count', () => {
    const doc = catalogItemDocument(item);
    expect(doc.docKey).toBe('item:i1');
    expect(doc.audiences).toEqual(['tenant_customer']);
    expect(doc.body).toContain('Price: ₹249 per btl (MRP ₹299)');
    expect(doc.body).toContain('Availability: Only a few left');
    expect(doc.body).toContain('- Variant 500 ml: ₹449 (Out of stock)');
    expect(doc.body).toContain('Cold pressed.');
    expect(doc.body).not.toMatch(/\b3\b/);
  });

  it('bands stock and skips services', () => {
    expect(stockBand(0, 'goods')).toBe('Out of stock');
    expect(stockBand(50, 'goods')).toBe('In stock');
    expect(stockBand(50, 'service')).toBeNull();
    expect(stockBand(null, 'goods')).toBeNull();
  });
});

describe('policy source', () => {
  const policy: PolicyRow = {
    name: 'Asha Stores', phone: '9800000001', email: null, address_line1: 'MG Road', company_introduction: 'Family shop since 1990.',
    store_about_md: null, store_contact_md: null, store_refund_md: '7-day returns on unopened items.', store_terms_md: '  ',
    store_min_order_amount: '200', store_allow_cod: true,
  };

  it('builds only the documents that have text', () => {
    const docs = buildPolicyDocuments(policy, []);
    expect(docs.map((d) => d.docKey)).toEqual(['about', 'contact', 'refund', 'delivery']);
    expect(docs.find((d) => d.docKey === 'contact')!.body).toContain('9800000001');
    expect(docs.every((d) => d.audiences.length === 1 && d.audiences[0] === 'tenant_customer')).toBe(true);
  });

  it('describes delivery zones and charges', () => {
    const text = deliveryMarkdown(policy, [
      { delivery_mode: 'radius', delivery_radius_km: 5, pincode_count: 0, allow_pickup: true, location_address: null, charges: [{ min_km: 0, max_km: 3, charge: '30', free_above: '500' }] },
    ])!;
    expect(text).toContain('Minimum order: ₹200.');
    expect(text).toContain('Cash on delivery is available.');
    expect(text).toContain('within 5 km');
    expect(text).toContain('0-3 km: ₹30 (free above ₹500)');
  });
});

describe('isolation', () => {
  it('requires a business id for tenant_customer and filters by it in SQL', () => {
    expect(() => scopeFilter({ audience: 'tenant_customer' }, 1)).toThrow();
    const f = scopeFilter({ audience: 'tenant_customer', businessId: BIZ_A }, 3);
    expect(f.sql).toContain('c.business_id = $4::uuid');
    expect(f.params).toEqual(['tenant_customer', BIZ_A]);
  });

  it('keeps platform audiences off tenant chunks', () => {
    expect(scopeFilter({ audience: 'prospect' }, 1).sql).toContain('c.business_id IS NULL');
    expect(() => scopeFilter({ audience: 'prospect', businessId: BIZ_A }, 1)).toThrow();
  });

  it('retrieves shop context only for the asking business', async () => {
    mockQueryOne.mockResolvedValueOnce({ ok: 1 });
    mockRetrieve.mockResolvedValueOnce({ chunks: [{ title: 'Coconut Hair Oil', content: 'Price: ₹249' }] });
    const ctx = await shopKnowledgeContext(BIZ_A, 'hair oil price');
    expect(mockRetrieve).toHaveBeenCalledWith(expect.objectContaining({ scope: { audience: 'tenant_customer', businessId: BIZ_A } }));
    expect(ctx).toContain('Coconut Hair Oil');
  });

  it('starts indexing on first use instead of answering from nothing', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await shopKnowledgeContext(BIZ_B, 'hair oil price')).toBeNull();
    expect(mockScheduleTenant).toHaveBeenCalledWith(BIZ_B, expect.any(String));
    expect(mockRetrieve).not.toHaveBeenCalled();
  });

  it('stale cleanup only touches the given business', async () => {
    mockQueryRows.mockResolvedValueOnce([{ id: 'S1', kind: 'tenant_policy', locator: 'policies' }]);
    const removed = await removeStaleTenantSources(BIZ_A, ['tenant_catalog', 'tenant_policy'], ['tenant_catalog:catalog']);
    expect(removed).toEqual(['tenant_policy:policies']);
    expect(mockQueryRows.mock.calls[0][0]).toContain('business_id = $1');
    expect(mockQueryRows.mock.calls[0][1][0]).toBe(BIZ_A);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('business_id = $1 AND id = ANY'), [BIZ_A, ['S1']]);
  });
});

describe('order status', () => {
  const order = {
    order_number: 'SO-1042', payment_status: 'paid', amount: '1250.00', delivery_status: 'ready_for_pickup',
    pickup_code: '4821', tracking_url: null, created_at: '2026-10-01T06:00:00Z', items: 'Hair Oil x2',
    public_token: 'abcdefghijklmnopqrstuvwx',
  };

  it('recognises order questions but not product or price questions', () => {
    expect(looksLikeOrderQuestion('where is my order?')).toBe(true);
    expect(looksLikeOrderQuestion('status of SO-1042')).toBe(true);
    expect(looksLikeOrderQuestion('mera parcel kab aayega')).toBe(true);
    expect(looksLikeOrderQuestion('I want to order 2 hair oil')).toBe(false);
    expect(looksLikeOrderQuestion('price of X100?')).toBe(false);
  });

  it('formats a readable status line', () => {
    expect(formatOrderStatus(order)).toBe(
      'Order SO-1042 (1 Oct): ready for pickup. Total ₹1,250, paid.\nItems: Hair Oil x2\nPickup code: 4821',
    );
  });

  it('shows the courier, rider and links only while the parcel is moving', () => {
    const text = formatOrderStatus(
      {
        ...order, delivery_status: 'out_for_delivery', payment_status: 'unpaid', cod_amount: '1250', partner_name: 'Delhivery',
        awb: 'AWB123', rider_name: 'Ramesh', rider_phone: '9876543210', tracking_url: 'https://www.delhivery.com/track/package/AWB123',
      },
      'https://khatario.com/track/abc',
    );
    expect(text).toContain('out for delivery. Total ₹1,250, cash on delivery.');
    expect(text).toContain('Courier: Delhivery, tracking no. AWB123');
    expect(text).toContain('Delivery partner: Ramesh 9876543210');
    expect(text).toContain('Order status: https://khatario.com/track/abc');
    expect(text).toContain('Courier tracking: https://www.delhivery.com/track/package/AWB123');
    expect(text).not.toContain('Pickup code');
  });

  it("looks up only this business's orders, from every channel, for the sender's own phone", async () => {
    mockQueryRows.mockResolvedValueOnce([order]);
    const text = await orderStatusContext(BIZ_A, '919811111111', 'where is my order SO-1042');
    const [sql, params] = mockQueryRows.mock.calls[0];
    expect(sql).toContain('FROM order_hub h');
    expect(sql).toContain('h.business_id = $1');
    expect(sql).toContain("right(regexp_replace(h.customer_phone");
    expect(params).toEqual([BIZ_A, '9811111111', 'SO-1042']);
    expect(text).toContain('SO-1042');
    expect(text).toContain('/track/abcdefghijklmnopqrstuvwx');
  });

  it('accepts a typed bill or WhatsApp order number', async () => {
    mockQueryRows.mockResolvedValue([]);
    await orderStatusContext(BIZ_A, '919811111111', 'status of SO-INV-0007');
    expect(mockQueryRows.mock.calls[0][1][2]).toBe('SO-INV-0007');
    await orderStatusContext(BIZ_A, '919811111111', 'track my order INV/25-26/0012');
    expect(mockQueryRows.mock.calls[1][1][2]).toBe('INV/25-26/0012');
  });

  it('does not reveal another number’s order when the typed number does not match', async () => {
    mockQueryRows.mockResolvedValueOnce([]);
    const text = await orderStatusContext(BIZ_A, '919822222222', 'track SO-1042');
    expect(text).toContain('No order SO-1042');
  });

  it('skips the lookup for non-order messages', async () => {
    expect(await orderStatusContext(BIZ_A, '919811111111', 'do you have shampoo')).toBeNull();
    expect(mockQueryRows).not.toHaveBeenCalled();
  });
});

describe('daily reply limit', () => {
  it('uses the business setting, then the default', async () => {
    mockQueryOne.mockResolvedValueOnce({ settings: { customerBotDailyLimit: 10 } }).mockResolvedValueOnce({ n: '10' });
    expect(await customerBotAllowed(BIZ_A)).toBe(false);
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ n: '10' });
    expect(await customerBotAllowed(BIZ_A)).toBe(true);
  });

  it('0 switches the bot off', async () => {
    mockQueryOne.mockResolvedValueOnce({ settings: { customerBotDailyLimit: 0 } });
    expect(await customerBotAllowed(BIZ_A)).toBe(false);
  });

  it('reads the setting for this business only', async () => {
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ n: '0' });
    await customerBotAllowed(BIZ_B);
    expect(mockQueryOne.mock.calls[0][1]).toEqual([`business:${BIZ_B}`]);
  });
});

describe('cloudReplyText', () => {
  it('lists buttons as numbered options', () => {
    expect(
      cloudReplyText('How can we help?', [{ title: 'Order status' }, { title: 'Call us', type: 'call', phone: '+919800000001' }], 'Asha Stores'),
    ).toBe('How can we help?\n\n1. Order status\n2. Call us +919800000001\n\n_Asha Stores_');
  });
});
