import { cartLineAddsGst, cartLineTotal } from '@/lib/store/pricing';
import { cartSavings } from '@/lib/store/quick';
import { storeCollectsGst, withStoreGst } from '@/lib/store/seller-gst';
import { buildStoreQuote } from '@/lib/store/quote';
import { queryRows } from '@/lib/db';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
  queryRows: jest.fn(),
  queryOne: jest.fn(),
}));

type Seller = { type: string | null; gstin: string | null; branchGstin?: string | null };

function fakeDb(s: Seller) {
  return {
    query: async (sql: string) =>
      sql.includes('default_branch_id')
        ? { rows: [{ gst_registration_type: s.type, default_branch_id: '11111111-1111-4111-8111-111111111111' }] }
        : { rows: [{ b_gstin: s.gstin, br_gstin: s.branchGstin ?? null }] },
  };
}

describe('storeCollectsGst', () => {
  const ask = (s: Seller, branchId?: string | null) =>
    storeCollectsGst({ businessId: 'b', branchId, db: fakeDb(s) });

  it('lets only a regular registration with a GSTIN charge GST', async () => {
    expect(await ask({ type: 'regular', gstin: '27AABCS1234J1Z5' })).toBe(true);
    expect(await ask({ type: 'composition', gstin: '27AABCS1234J1Z5' })).toBe(false);
    expect(await ask({ type: 'regular', gstin: null })).toBe(false);
    expect(await ask({ type: 'unregistered', gstin: null })).toBe(false);
  });

  it('treats a stale unregistered flag with a GSTIN as regular', async () => {
    expect(await ask({ type: 'unregistered', gstin: '27AABCS1234J1Z5' })).toBe(true);
  });

  it('counts a branch GSTIN, and survives a junk branch id', async () => {
    expect(await ask({ type: null, gstin: null, branchGstin: '29AABCS1234J1Z5' })).toBe(true);
    expect(await ask({ type: 'regular', gstin: '27AABCS1234J1Z5' }, 'not-a-uuid')).toBe(true);
  });
});

describe('withStoreGst', () => {
  it('hides the GST rate only when the seller cannot charge it', () => {
    const p = { id: 'x', tax_rate: 18, gst_included: true };
    expect(withStoreGst(p, true)).toEqual(p);
    expect(withStoreGst(p, false)).toEqual({ id: 'x', tax_rate: 0, gst_included: false });
  });
});

describe('cart totals', () => {
  it('adds GST to GST-extra lines, matching the quote', () => {
    expect(cartLineTotal({ price: 100, quantity: 2, taxRate: 18, gstIncluded: false })).toBe(236);
    expect(cartLineAddsGst({ taxRate: 18, gstIncluded: false })).toBe(true);
  });

  it('leaves GST-included, zero-rated and older saved lines at their price', () => {
    expect(cartLineTotal({ price: 118, quantity: 1, taxRate: 18, gstIncluded: true })).toBe(118);
    expect(cartLineTotal({ price: 100, quantity: 1, taxRate: 0, gstIncluded: false })).toBe(100);
    expect(cartLineTotal({ price: 100, quantity: 1, taxRate: 18 })).toBe(100);
    expect(cartLineAddsGst({ taxRate: 18 })).toBe(false);
  });

  it('counts MRP savings against what the shopper really pays', () => {
    expect(cartSavings([{ price: 100, mrp: 150, quantity: 1, taxRate: 18, gstIncluded: false }])).toBe(32);
    expect(cartSavings([{ price: 100, mrp: 110, quantity: 1, taxRate: 18, gstIncluded: false }])).toBe(0);
    expect(cartSavings([{ price: 100, mrp: 150, quantity: 2 }])).toBe(100);
  });
});

describe('buildStoreQuote', () => {
  const ITEM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const row = (gst_included: boolean, selling_price: string) => ({
    id: ITEM,
    name: 'Widget',
    unit: 'PCS',
    selling_price,
    tax_rate: '18',
    gst_included,
    show_in_store: true,
    is_active: true,
    deleted_at: null,
  });
  const quote = async (seller: Seller, item: ReturnType<typeof row>) => {
    (queryRows as jest.Mock).mockResolvedValueOnce([item]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/lib/db').getPool as jest.Mock).mockReturnValue(fakeDb(seller));
    return buildStoreQuote({
      businessId: 'b',
      minOrderAmount: 0,
      items: [{ item_id: ITEM, quantity: 1 }],
      deliveryMode: 'pickup',
    });
  };
  const regular = { type: 'regular', gstin: '27AABCS1234J1Z5' };
  const composition = { type: 'composition', gstin: '27AABCS1234J1Z5' };
  const noGstin = { type: 'unregistered', gstin: null };

  it('still charges GST for a regular seller', async () => {
    expect(await quote(regular, row(false, '100'))).toMatchObject({ grand_total: 118, tax_total: 18 });
    expect(await quote(regular, row(true, '118'))).toMatchObject({ grand_total: 118, tax_total: 18 });
  });

  it.each([
    ['composition', composition],
    ['no GSTIN', noGstin],
  ])('charges the plain price and no GST for a %s seller', async (_n, seller) => {
    const extra = await quote(seller, row(false, '100'));
    expect(extra).toMatchObject({ serviceable: true, grand_total: 100, tax_total: 0 });
    expect(extra.lines[0]).toMatchObject({ tax_rate: 0, gst_included: false, line_total: 100 });
    expect(await quote(seller, row(true, '118'))).toMatchObject({ grand_total: 118, tax_total: 0 });
  });
});
