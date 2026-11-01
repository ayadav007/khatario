const loadEngineTheme = jest.fn();
const queryOne = jest.fn();
jest.mock('@/lib/store/engine/load-theme', () => ({ loadEngineTheme: (...a: unknown[]) => loadEngineTheme(...a) }));
jest.mock('@/lib/db', () => ({ queryOne: (...a: unknown[]) => queryOne(...a) }));

import { oosPlaceValue, storeOosPlace, themeOosPlace } from '@/lib/store/engine/oos-place';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';

const store = { business_id: 'b1', is_demo: false } as unknown as StoreBusinessContext;
const themeWith = (oos_place: unknown) => ({ theme: { data: { settings: { product_card: { oos_place } } } }, preview: false });

beforeEach(() => {
  loadEngineTheme.mockReset();
  queryOne.mockReset();
});

describe('oosPlaceValue', () => {
  it.each([['end'], ['hide']])('reads %s', (v) => {
    expect(oosPlaceValue(v)).toBe(v);
  });
  it.each([['stay'], ['junk'], ['END'], [' hide'], [''], [undefined], [null], [1], [{}]])('treats %p as stay', (v) => {
    expect(oosPlaceValue(v)).toBe('stay');
  });
});

describe('themeOosPlace', () => {
  it.each([['end'], ['hide']])('reads %s', (v) => {
    expect(themeOosPlace({ settings: { product_card: { oos_place: v } } } as never)).toBe(v);
  });
  it.each([['stay'], ['junk'], [undefined], [null]])('treats %s as stay', (v) => {
    expect(themeOosPlace({ settings: { product_card: { oos_place: v } } } as never)).toBe('stay');
  });
  it('treats a missing theme as stay', () => {
    expect(themeOosPlace(null)).toBe('stay');
    expect(themeOosPlace({ settings: {} } as never)).toBe('stay');
  });
});

describe('storeOosPlace', () => {
  it('reads only the live value, without loading the whole theme, when there is no preview', async () => {
    queryOne.mockResolvedValue({ oos_place: 'end' });
    expect(await storeOosPlace(store, new URLSearchParams('q=x&branch_id=br'))).toBe('end');
    expect(loadEngineTheme).not.toHaveBeenCalled();
    expect(queryOne).toHaveBeenCalledTimes(1);
    const [sql, params] = queryOne.mock.calls[0];
    expect(params).toEqual(['b1']);
    expect(sql).toContain("st.data->'settings'->'product_card'->>'oos_place'");
    expect(sql).toContain("st.role = 'live'");
    expect(sql).toContain('bs.store_engine = true');
    expect(sql).toContain('bs.business_id = $1');
  });
  it.each([[{ oos_place: 'junk' }], [{ oos_place: null }], [null]])('is stay when the live value is %p', async (row) => {
    queryOne.mockResolvedValue(row);
    expect(await storeOosPlace(store, new URLSearchParams())).toBe('stay');
  });
  it('is stay when the value lookup fails', async () => {
    queryOne.mockRejectedValue(new Error('db down'));
    expect(await storeOosPlace(store, new URLSearchParams())).toBe('stay');
  });
  it('loads the engine theme for a preview, passing the token along', async () => {
    loadEngineTheme.mockResolvedValue(themeWith('hide'));
    const sp = new URLSearchParams('preview_theme=t1&pt=tok&q=x');
    expect(await storeOosPlace(store, sp)).toBe('hide');
    expect(loadEngineTheme).toHaveBeenCalledWith(store, { preview_theme: 't1', pt: 'tok' });
    expect(queryOne).not.toHaveBeenCalled();
  });
  it('is stay for a preview of a store without the engine', async () => {
    loadEngineTheme.mockResolvedValue(null);
    expect(await storeOosPlace(store, new URLSearchParams('preview_theme=t1&pt=tok'))).toBe('stay');
  });
  it('is stay when the previewed theme fails to load', async () => {
    loadEngineTheme.mockRejectedValue(new Error('db down'));
    expect(await storeOosPlace(store, new URLSearchParams('preview_theme=t1&pt=tok'))).toBe('stay');
  });
  it('is stay for a demo store without loading anything', async () => {
    expect(await storeOosPlace({ ...store, is_demo: true }, new URLSearchParams())).toBe('stay');
    expect(await storeOosPlace({ ...store, is_demo: true }, new URLSearchParams('preview_theme=t1&pt=tok'))).toBe('stay');
    expect(loadEngineTheme).not.toHaveBeenCalled();
    expect(queryOne).not.toHaveBeenCalled();
  });
});

describe('the product page is never affected by the out-of-stock place', () => {
  // Source checks (as in catalog-links.test.ts): the product page and its API read one product by id, outside the list query.
  const { readFileSync } = require('fs') as typeof import('fs');
  it.each([['app/api/public/store/[subdomain]/items/[id]/route.ts'], ['app/store/products/[id]/layout.tsx']])(
    '%s does not use the list query or the setting',
    (file) => {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toMatch(/store-items-query|oos-place|outOfStock|oos_place/);
    },
  );
});
