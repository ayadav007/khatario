/**
 * GET /api/settings/online-store keeps working where migration 450 (business_settings.store_engine)
 * has not run yet: a 42703 on the first read is retried without the column and reads as engine off.
 */
import { NextRequest } from 'next/server';

const queryOne = jest.fn();
const queryRows = jest.fn();
jest.mock('@/lib/db', () => ({
  queryOne: (...a: unknown[]) => queryOne(...a),
  queryRows: (...a: unknown[]) => queryRows(...a),
}));
jest.mock('@/lib/payments/secret-encryption', () => ({ encryptPaymentSecret: jest.fn() }));
jest.mock('@/lib/rag/tenant-reindex', () => ({ noteShopChanged: jest.fn() }));
jest.mock('@/lib/subscription/feature-access', () => ({ denyIfFeatureMissing: jest.fn() }));
jest.mock('@/lib/security/require-tenant-permission', () => ({ requireTenantPermission: jest.fn() }));

import { GET } from '@/app/api/settings/online-store/route';

const BIZ = '11111111-1111-4111-8111-111111111111';
const get = () =>
  new NextRequest('http://localhost/api/settings/online-store', {
    headers: { 'x-authenticated-business-id': BIZ },
  });

const settingsRow = { store_subdomain: 'ganesh', store_enabled: true, store_tagline: null, store_hero_image_url: null, store_min_order_amount: '0' };

function missingColumn(): Error {
  return Object.assign(new Error('column "store_engine" does not exist'), { code: '42703' });
}

beforeEach(() => {
  jest.clearAllMocks();
  queryRows.mockResolvedValue([]);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('GET /api/settings/online-store', () => {
  it('returns store_engine from the row when the column exists', async () => {
    queryOne.mockImplementation(async (sql: string) =>
      sql.includes('business_settings') ? { ...settingsRow, store_engine: true } : { logo_url: null },
    );
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect((await res.json()).store_engine).toBe(true);
  });

  it('retries without store_engine on 42703 and reports it off', async () => {
    const settingsSql: string[] = [];
    queryOne.mockImplementation(async (sql: string) => {
      if (!sql.includes('business_settings')) return { logo_url: null };
      settingsSql.push(sql);
      if (sql.includes('store_engine')) throw missingColumn();
      return settingsRow;
    });
    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.store_engine).toBe(false);
    expect(body.store_subdomain).toBe('ganesh');
    expect(settingsSql).toHaveLength(2);
    expect(settingsSql[1]).not.toContain('store_engine');
  });

  it('still fails on other database errors', async () => {
    queryOne.mockImplementation(async (sql: string) => {
      if (!sql.includes('business_settings')) return { logo_url: null };
      throw Object.assign(new Error('boom'), { code: '57P01' });
    });
    const res = await GET(get());
    expect(res.status).toBe(500);
  });
});
