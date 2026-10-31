jest.mock('@/lib/db', () => {
  const boom = () => {
    throw new Error('the database must not be called');
  };
  return {
    queryOne: jest.fn(boom),
    queryRows: jest.fn(boom),
    query: jest.fn(boom),
    getPool: jest.fn(boom),
  };
});

import { queryOne } from '@/lib/db';
import { demoEngineTheme, loadEngineTheme } from '@/lib/store/engine/load-theme';
import { loadEnginePage } from '@/lib/store/engine/page-loader';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import { themeDemoStore } from '@/lib/store/theme-demo';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';

const demo = (sub: string): StoreBusinessContext => {
  const s = themeDemoStore(sub);
  if (!s) throw new Error(`no demo ${sub}`);
  return s;
};

const queryOneMock = queryOne as jest.Mock;

describe('demo stores on the engine (D35)', () => {
  it('?engine=1 on theme-grocery gives the migrated Grocery theme as a preview', async () => {
    const out = await loadEngineTheme(demo('theme-grocery'), { engine: '1' });
    expect(out).not.toBeNull();
    expect(out!.preview).toBe(true);
    expect(out!.demo).toBe(true);
    expect(out!.theme.preset).toBe('grocery');
    const home = out!.theme.data.templates.home;
    expect(home.order.map((id) => home.sections[id].type)).toContain('promo-cards');
    expect(queryOneMock).not.toHaveBeenCalled();
  });

  it('without engine (or with another value) a demo store stays on the old storefront', async () => {
    expect(await loadEngineTheme(demo('theme-grocery'), {})).toBeNull();
    expect(await loadEngineTheme(demo('theme-grocery'), { engine: '0' })).toBeNull();
    expect(await loadEngineTheme(demo('theme-grocery'), { engine: null })).toBeNull();
  });

  it.each(['theme-studio', 'theme-khatario', 'theme-grocery', 'theme-quick'])(
    '%s renders a fixed, sanitised theme for its own pack',
    (sub) => {
      const store = demo(sub);
      const theme = demoEngineTheme(store);
      expect(theme).toMatchObject({
        id: '00000000-0000-4000-8000-0000000000e1',
        business_id: store.business_id,
        role: 'live',
        is_working: false,
        updated_at: '1970-01-01T00:00:00.000Z',
        preset: store.store_theme!.pack,
      });
      expect(sanitizeThemeData(theme.data)).toEqual(theme.data);
      expect(demoEngineTheme(demo(sub))).toEqual(theme);
    },
  );

  it('a real store ignores engine=1', async () => {
    queryOneMock.mockImplementationOnce(async () => ({ store_engine: false }));
    const store = { ...demo('theme-grocery'), is_demo: false, business_id: '11111111-2222-4333-8444-555555555555' };
    expect(await loadEngineTheme(store, { engine: '1' })).toBeNull();
    expect(queryOneMock).toHaveBeenCalledTimes(1);
  });

  it('loadEnginePage passes engine through and is never in editor mode for a demo theme', async () => {
    const page = await loadEnginePage(demo('theme-grocery'), { engine: '1', editor: '1' }, 'home');
    expect(page).not.toBeNull();
    expect(page!.preview).toBe(true);
    expect(page!.editor).toBe(false);
    expect(page!.template?.order.length).toBeGreaterThan(0);
  });
});
