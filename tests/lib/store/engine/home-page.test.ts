jest.mock('@/lib/store/engine/load-theme', () => ({ loadEngineTheme: jest.fn() }));
jest.mock('@/lib/store/engine/section-data', () => ({
  collectDataRequests: jest.fn(() => new Map()),
  resolveSectionData: jest.fn(),
}));

import { loadEngineHome } from '@/lib/store/engine/home-page';
import { loadEngineTheme } from '@/lib/store/engine/load-theme';
import { resolveSectionData } from '@/lib/store/engine/section-data';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';

const store = { business_id: 'b1', store_subdomain: 'ganesh' } as StoreBusinessContext;
const theme = {
  id: 't1',
  data: { settings: {}, header_group: { order: [], sections: {} }, footer_group: { order: [], sections: {} }, templates: {} },
};
const CAT = '11111111-2222-3333-4444-555555555555';

const loadMock = loadEngineTheme as jest.Mock;
const resolveMock = resolveSectionData as jest.Mock;

let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

describe('loadEngineHome', () => {
  it('falls back (null) and logs when loading the theme throws', async () => {
    loadMock.mockRejectedValue(new Error('column "store_engine" does not exist'));
    await expect(loadEngineHome(store, {})).resolves.toBeNull();
    expect(errSpy).toHaveBeenCalledWith('[store engine]', 'ganesh', 'column "store_engine" does not exist');
  });

  it('falls back (null) when resolving section data throws', async () => {
    loadMock.mockResolvedValue({ theme, preview: false });
    resolveMock.mockRejectedValue(new Error('db down'));
    await expect(loadEngineHome(store, {})).resolves.toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns null without logging when the engine is off', async () => {
    loadMock.mockResolvedValue(null);
    await expect(loadEngineHome(store, {})).resolves.toBeNull();
    expect(resolveMock).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('logs a missing-migration error once per process and still falls back', async () => {
    loadMock.mockRejectedValue({ code: '42703' });
    await expect(loadEngineHome(store, {})).resolves.toBeNull();
    await expect(loadEngineHome(store, {})).resolves.toBeNull();
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it('passes preview params and narrowing, ignoring a malformed category id', async () => {
    loadMock.mockResolvedValue({ theme, preview: true });
    resolveMock.mockResolvedValue({ s1: { products: [] } });
    const out = await loadEngineHome(store, { preview_theme: ['p1', 'p2'], pt: 'tok', cat: 'nope', q: '  rice ' });
    expect(loadMock).toHaveBeenCalledWith(store, { preview_theme: 'p1', pt: 'tok', engine: null });
    expect(resolveMock).toHaveBeenCalledWith(store, expect.any(Map), { categoryId: null, search: 'rice' });
    expect(out).toEqual({ theme, preview: true, editor: false, template: null, data: { s1: { products: [] } } });

    await loadEngineHome(store, { cat: CAT });
    expect(resolveMock).toHaveBeenLastCalledWith(store, expect.any(Map), { categoryId: CAT, search: null });
  });

  it('turns editor mode on only for a verified preview with editor=1', async () => {
    resolveMock.mockResolvedValue({});
    loadMock.mockResolvedValue({ theme, preview: true });
    expect((await loadEngineHome(store, { editor: '1' }))?.editor).toBe(true);
    expect((await loadEngineHome(store, { editor: ['1', '0'] }))?.editor).toBe(true);
    expect((await loadEngineHome(store, { editor: 'true' }))?.editor).toBe(false);
    expect((await loadEngineHome(store, {}))?.editor).toBe(false);

    loadMock.mockResolvedValue({ theme, preview: false });
    expect((await loadEngineHome(store, { editor: '1' }))?.editor).toBe(false);
  });
});
