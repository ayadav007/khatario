/**
 * Offers and search suggestions resolve the store like the items APIs (storeForPublicApi): a verified `td`,
 * then an engine theme or version preview, so a preview link of an unlaunched store gets them too.
 */
import { NextRequest } from 'next/server';

const storeForPublicApi = jest.fn();
const queryRows = jest.fn();
jest.mock('@/lib/store/engine/preview-access', () => ({ storeForPublicApi: (...a: unknown[]) => storeForPublicApi(...a) }));
jest.mock('@/lib/store/preview-store', () => ({
  resolveStoreWithDraft: jest.fn(async () => {
    throw new Error('routes must go through storeForPublicApi');
  }),
}));
jest.mock('@/lib/db', () => ({ queryRows: (...a: unknown[]) => queryRows(...a) }));

import * as offersRoute from '@/app/api/public/store/[subdomain]/offers/route';
import * as suggestRoute from '@/app/api/public/store/[subdomain]/search/suggest/route';

const BIZ = '0b6f5f39-6a52-4d8e-9a0e-0c6d8a3b1f21';
const store = { business_id: BIZ, is_demo: false };
const req = (path: string, qs: string) => new NextRequest(`http://localhost:3000/api/public/store/shop${path}?${qs}`);
const params = { params: { subdomain: 'shop' } };
const PREVIEW = `preview_theme=${BIZ}&pt=tok&td=draft`;

beforeEach(() => {
  storeForPublicApi.mockReset();
  queryRows.mockReset();
});

describe('offers route', () => {
  it('passes the subdomain and the request query to storeForPublicApi and keeps its response shape', async () => {
    storeForPublicApi.mockResolvedValue(store);
    queryRows.mockResolvedValue([{ code: 'SAVE5', discount_type: 'percent', discount_value: '5', min_order_amount: '100' }]);
    const res = await offersRoute.GET(req('/offers', PREVIEW), params);
    expect(res.status).toBe(200);
    const [sub, sp] = storeForPublicApi.mock.calls[0];
    expect(sub).toBe('shop');
    expect(sp).toBeInstanceOf(URLSearchParams);
    expect(Object.fromEntries(sp as URLSearchParams)).toEqual({ preview_theme: BIZ, pt: 'tok', td: 'draft' });
    expect(await res.json()).toEqual({
      coupons: [{ code: 'SAVE5', discount_type: 'percent', discount_value: 5, min_order_amount: 100 }],
    });
    expect(queryRows.mock.calls[0][1]).toEqual([BIZ]);
  });

  it('is 404 when storeForPublicApi finds no store', async () => {
    storeForPublicApi.mockResolvedValue(null);
    const res = await offersRoute.GET(req('/offers', PREVIEW), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Store not found' });
    expect(queryRows).not.toHaveBeenCalled();
  });
});

describe('search suggest route', () => {
  it('passes the request query to storeForPublicApi and keeps its response shape', async () => {
    storeForPublicApi.mockResolvedValue(store);
    queryRows.mockResolvedValueOnce([{ id: 'p1', name: 'Pen' }]).mockResolvedValueOnce([{ id: 'c1', name: 'Pens' }]);
    const res = await suggestRoute.GET(req('/search/suggest', `q=pen&${PREVIEW}`), params);
    expect(res.status).toBe(200);
    const [sub, sp] = storeForPublicApi.mock.calls[0];
    expect(sub).toBe('shop');
    expect(Object.fromEntries(sp as URLSearchParams)).toEqual({ q: 'pen', preview_theme: BIZ, pt: 'tok', td: 'draft' });
    expect(await res.json()).toEqual({ products: [{ id: 'p1', name: 'Pen' }], categories: [{ id: 'c1', name: 'Pens' }] });
  });

  it('is 404 when storeForPublicApi finds no store', async () => {
    storeForPublicApi.mockResolvedValue(null);
    const res = await suggestRoute.GET(req('/search/suggest', `q=pen&${PREVIEW}`), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Store not found' });
    expect(queryRows).not.toHaveBeenCalled();
  });
});

describe('the header search suggestions carry the preview params', () => {
  // A client component: a source check keeps the rule cheap (as in catalog-links.test.ts).
  it('SearchSuggest builds its query with withStoreDraft', () => {
    const { readFileSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const src = readFileSync(join(process.cwd(), 'components/store/features/catalog/SearchSuggest.tsx'), 'utf8');
    expect(src).toContain('withStoreDraft(');
    expect(src).not.toMatch(/search\/suggest\?q=\$\{/);
  });
});
