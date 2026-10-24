/**
 * Invoice-viewed live events go to every active member of the business, including users whose
 * users.business_id now points at another business they switched to.
 */
const mockQueryRows = jest.fn();
const mockQueryOne = jest.fn();
const mockQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  queryRows: (...a: unknown[]) => mockQueryRows(...a),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  query: (...a: unknown[]) => mockQuery(...a),
}));
const mockPublish = jest.fn().mockResolvedValue(1);
jest.mock('@/lib/queue/redis', () => ({
  getRedisConnection: () => ({ status: 'ready', publish: mockPublish }),
}));

import { recordInvoiceCustomerView } from '@/lib/customer-surface/record-view';

const BIZ = '22222222-2222-4222-8222-222222222222';
const INVOICE = '44444444-4444-4444-8444-444444444444';
const HOME_USER = '11111111-1111-4111-8111-111111111111';
const SWITCHED_MEMBER = '55555555-5555-4555-8555-555555555555';

describe('invoice viewed recipients', () => {
  beforeEach(() => {
    mockQueryOne.mockReset().mockResolvedValue({ first_viewed_at: 'now', view_count: 1 });
    mockQuery.mockReset().mockResolvedValue({ rowCount: 1, rows: [] });
    mockPublish.mockClear();
    mockQueryRows.mockReset().mockImplementation(async (sql: string) => {
      if (/customer_surface_settings/.test(sql)) return [];
      if (/INSERT INTO notifications/.test(sql)) return [{ id: 'n1' }];
      if (/FROM users u/.test(sql)) return [{ id: HOME_USER }, { id: SWITCHED_MEMBER }];
      throw new Error(`unexpected queryRows: ${sql}`);
    });
  });

  it('selects recipients by home business or user_businesses membership', async () => {
    await recordInvoiceCustomerView({
      invoiceId: INVOICE,
      businessId: BIZ,
      customerName: 'Asha',
      invoiceNumber: 'INV-1',
      source: 'public_link',
    });

    const [sql, params] = mockQueryRows.mock.calls.find(([s]) => /FROM users u/.test(s))!;
    expect(params).toEqual([BIZ]);
    expect(sql).toMatch(/u\.business_id = \$1/);
    expect(sql).toMatch(/FROM user_businesses ub WHERE ub\.user_id = u\.id AND ub\.business_id = \$1/);
    expect(sql).toMatch(/u\.is_active = true/);

    const published = mockPublish.mock.calls.map(([, payload]) => JSON.parse(payload));
    expect(published.map((p) => p.userId)).toEqual([HOME_USER, SWITCHED_MEMBER]);
    expect(published.every((p) => p.businessId === BIZ && p.type === 'invoice_viewed')).toBe(true);
  });
});
