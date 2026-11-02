/**
 * Premium presets sit behind a per-store flag: the themes POST refuses a fresh premium preset while the flag is
 * off, and never gates duplicates, the migrated design, or the other presets. GET reports the flag.
 */
import { NextRequest } from 'next/server';

const mockPermission = jest.fn();
const mockPlan = jest.fn();
const mockPremium = jest.fn();
const mockCreate = jest.fn();
const mockList = jest.fn();

jest.mock('@/lib/security/require-tenant-permission', () => ({ requireTenantPermission: (...a: unknown[]) => mockPermission(...a) }));
jest.mock('@/lib/subscription/feature-access', () => ({ denyIfFeatureMissing: (...a: unknown[]) => mockPlan(...a) }));
jest.mock('@/lib/store/engine/premium', () => ({ premiumThemesEnabled: (...a: unknown[]) => mockPremium(...a) }));
jest.mock('@/lib/store/engine/preset-context', () => ({ presetContextFor: jest.fn(async () => ({ businessName: 'Biz', tagline: '' })) }));
jest.mock('@/lib/store/engine/themes-repo', () => ({
  createTheme: (...a: unknown[]) => mockCreate(...a),
  listThemes: (...a: unknown[]) => mockList(...a),
}));

import { GET, POST } from '@/app/api/settings/online-store/themes/route';

const URL_ = 'http://localhost:3000/api/settings/online-store/themes';
const DUP = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const post = (body: Record<string, unknown>) =>
  POST(new NextRequest(URL_, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));

beforeEach(() => {
  jest.resetAllMocks();
  mockPermission.mockResolvedValue({ ok: true, businessId: 'biz-1', userId: 'user-1' });
  mockPlan.mockResolvedValue(null);
  mockPremium.mockResolvedValue(false);
  mockCreate.mockResolvedValue({ ok: true, value: { id: 't1', name: 'T' } });
  mockList.mockResolvedValue([]);
});

describe('themes POST with the premium flag off', () => {
  it('refuses a fresh premium preset', async () => {
    const res = await post({ preset: 'heritage' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Premium themes are not enabled for this store', code: 'premium_locked' });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockPremium).toHaveBeenCalledWith('biz-1');
  });

  it('allows a premium preset once the flag is on', async () => {
    mockPremium.mockResolvedValue(true);
    expect((await post({ preset: 'heritage' })).status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('refuses Drop Culture while the flag is off and allows it once on', async () => {
    const res = await post({ preset: 'drop' });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('premium_locked');
    expect(mockCreate).not.toHaveBeenCalled();
    mockPremium.mockResolvedValue(true);
    expect((await post({ preset: 'drop' })).status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith('biz-1', 'user-1', expect.objectContaining({ preset: 'drop' }));
  });

  it('never gates a duplicate of an existing theme', async () => {
    const res = await post({ preset: 'heritage', duplicate_of: DUP });
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith('biz-1', 'user-1', expect.objectContaining({ preset: 'heritage', duplicateOf: DUP }));
  });

  it('never gates the migrated design', async () => {
    expect((await post({ source: 'migrated', preset: 'heritage' })).status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('never gates a non-premium preset', async () => {
    expect((await post({ preset: 'studio' })).status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockPremium).not.toHaveBeenCalled();
  });

  it('keeps the default preset ungated', async () => {
    expect((await post({})).status).toBe(201);
  });
});

describe('themes GET', () => {
  it('returns the rows and the flag', async () => {
    const res = await GET(new NextRequest(URL_));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ themes: [], premium_enabled: false });
    mockPremium.mockResolvedValue(true);
    expect((await (await GET(new NextRequest(URL_))).json()).premium_enabled).toBe(true);
  });

  it('reads the flag as off when it cannot be read, and still lists the themes', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockPremium.mockRejectedValue(new Error('column "premium_themes_enabled" does not exist'));
    const res = await GET(new NextRequest(URL_));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ themes: [], premium_enabled: false });
    spy.mockRestore();
  });
});
