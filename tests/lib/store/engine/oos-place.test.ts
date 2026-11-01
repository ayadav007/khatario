const loadEngineTheme = jest.fn();
jest.mock('@/lib/store/engine/load-theme', () => ({ loadEngineTheme: (...a: unknown[]) => loadEngineTheme(...a) }));

import { storeOosPlace, themeOosPlace } from '@/lib/store/engine/oos-place';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';

const store = { business_id: 'b1', is_demo: false } as unknown as StoreBusinessContext;
const themeWith = (oos_place: unknown) => ({ theme: { data: { settings: { product_card: { oos_place } } } }, preview: false });

beforeEach(() => loadEngineTheme.mockReset());

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
  it('reads the engine theme, passing the preview token along', async () => {
    loadEngineTheme.mockResolvedValue(themeWith('hide'));
    const sp = new URLSearchParams('preview_theme=t1&pt=tok&q=x');
    expect(await storeOosPlace(store, sp)).toBe('hide');
    expect(loadEngineTheme).toHaveBeenCalledWith(store, { preview_theme: 't1', pt: 'tok' });
  });
  it('is stay for a store without the engine', async () => {
    loadEngineTheme.mockResolvedValue(null);
    expect(await storeOosPlace(store, new URLSearchParams())).toBe('stay');
  });
  it('is stay for a demo store without loading anything', async () => {
    expect(await storeOosPlace({ ...store, is_demo: true }, new URLSearchParams())).toBe('stay');
    expect(loadEngineTheme).not.toHaveBeenCalled();
  });
  it('is stay when the theme fails to load', async () => {
    loadEngineTheme.mockRejectedValue(new Error('db down'));
    expect(await storeOosPlace(store, new URLSearchParams())).toBe('stay');
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
