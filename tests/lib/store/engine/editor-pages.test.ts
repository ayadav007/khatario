import { presetTheme } from '@/lib/store/engine/presets';
import { PAGE_STARTERS } from '@/lib/store/engine/presets/templates';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import { sanitizeSettingValue } from '@/lib/store/engine/settings';
import type { SettingSchema } from '@/lib/store/engine/schema-types';
import type { ThemeData } from '@/lib/store/engine/types';
import { OP_ERROR_TEXT, addPage, removePage, setPageMeta, slugifyHandle } from '@/lib/store/engine/editor/ops';
import { linkChoice, linkOptions } from '@/lib/store/engine/editor/fields';
import { customPages, openTemplateKey, templateOptions } from '@/lib/store/engine/editor/tree';

const fixture = () => presetTheme('studio', { businessName: 'Rose Mart', tagline: 'Fresh', accent: '#e11d48' });
const ids = () => {
  let n = 0;
  return () => `pg${++n}`;
};
const ok = (r: any) => {
  expect(r.ok).toBe(true);
  return r.theme as ThemeData;
};

describe('custom page ops', () => {
  it('slugifyHandle lowercases, hyphenates, trims to 50 and strips edge hyphens', () => {
    expect(slugifyHandle('  Diwali Sale 2026! ')).toBe('diwali-sale-2026');
    expect(slugifyHandle('Café & Bakery')).toBe('caf-bakery');
    expect(slugifyHandle('!!!')).toBe('');
    const long = slugifyHandle(`${'a'.repeat(49)} b`);
    expect(long).toBe('a'.repeat(49));
    expect(slugifyHandle('x'.repeat(80))).toHaveLength(50);
  });

  it('addPage creates page.<handle> with the starter sections and the title', () => {
    const t = fixture();
    const r: any = addPage(t, { handle: 'sale', title: 'Diwali Sale', starter: 'sale' }, ids());
    const next = ok(r);
    expect(r.id).toBe('page.sale');
    const page = next.templates['page.sale'];
    expect(page.title).toBe('Diwali Sale');
    const starter = PAGE_STARTERS.sale.build();
    expect(page.order.map((id) => page.sections[id].type)).toEqual(starter.order.map((id) => starter.sections[id].type));
    expect(page.order).toEqual(['pg1', 'pg2']);
    // The input is untouched.
    expect(t.templates['page.sale']).toBeUndefined();
    // Survives the server sanitiser unchanged in shape.
    expect(sanitizeThemeData(next).templates['page.sale'].order).toEqual(page.order);
  });

  it('addPage refuses reserved, taken and invalid handles', () => {
    const t = ok(addPage(fixture(), { handle: 'sale', title: 'Sale', starter: 'blank' }));
    expect(addPage(t, { handle: 'cart', title: 'Cart', starter: 'blank' })).toEqual({ ok: false, reason: 'handle_reserved' });
    expect(addPage(t, { handle: 'sale', title: 'Sale 2', starter: 'blank' })).toEqual({ ok: false, reason: 'handle_taken' });
    expect(addPage(t, { handle: '-a', title: 'A', starter: 'blank' })).toEqual({ ok: false, reason: 'handle_invalid' });
    expect(addPage(t, { handle: 'Big Sale', title: 'A', starter: 'blank' })).toEqual({ ok: false, reason: 'handle_invalid' });
    expect(OP_ERROR_TEXT.handle_reserved).toBe('That address is used by the store');
    expect(OP_ERROR_TEXT.handle_taken).toBe('Another page already uses this address');
    expect(OP_ERROR_TEXT.handle_invalid).toBe('Use lowercase letters, numbers and hyphens');
  });

  it('addPage refuses the 31st page', () => {
    let t = fixture();
    for (let i = 1; i <= 30; i++) t = ok(addPage(t, { handle: `p${i}`, title: `P${i}`, starter: 'blank' }));
    expect(addPage(t, { handle: 'p31', title: 'P31', starter: 'blank' })).toEqual({ ok: false, reason: 'page_limit' });
    expect(OP_ERROR_TEXT.page_limit).toBe('This theme already has 30 pages');
  });

  it('removePage deletes the page and refuses core templates or missing pages', () => {
    const t = ok(addPage(fixture(), { handle: 'sale', title: 'Sale', starter: 'sale' }));
    const next = ok(removePage(t, 'page.sale'));
    expect(next.templates['page.sale']).toBeUndefined();
    expect(removePage(next, 'page.sale')).toEqual({ ok: false, reason: 'not_found' });
    expect(removePage(t, 'home')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('setPageMeta clips to the D22 caps and clears empty fields', () => {
    const t = ok(addPage(fixture(), { handle: 'sale', title: 'Sale', starter: 'blank' }));
    const next = ok(setPageMeta(t, 'page.sale', { title: 'x'.repeat(150), seo_title: 'y'.repeat(150), seo_description: 'z'.repeat(400) }));
    const page = next.templates['page.sale'];
    expect(page.title).toHaveLength(100);
    expect(page.seo_title).toHaveLength(120);
    expect(page.seo_description).toHaveLength(320);
    const cleared = ok(setPageMeta(next, 'page.sale', { seo_title: '' })).templates['page.sale'];
    expect(cleared.seo_title).toBeUndefined();
    expect(cleared.title).toHaveLength(100);
    expect(setPageMeta(t, 'home', { title: 'x' })).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('custom pages in the editor', () => {
  it('linkOptions adds /pages/<handle> after the categories, and every option passes the url rule', () => {
    const cats = [{ id: '11111111-1111-1111-1111-111111111111', name: 'Fruit' }];
    const opts = linkOptions(cats, [{ handle: 'sale', title: 'Diwali Sale' }]);
    expect(opts.map((o) => o.value)).toEqual(['/', '/catalog', '/catalog/11111111-1111-1111-1111-111111111111', '/pages/sale']);
    expect(opts[3].label).toBe('Diwali Sale');
    expect(linkChoice('/pages/sale', cats, [{ handle: 'sale', title: 'Diwali Sale' }])).toBe('/pages/sale');
    expect(linkChoice('/pages/sale', cats)).toBe('custom');
    const schema: SettingSchema = { id: 'l', type: 'url', label: 'L' };
    for (const o of opts) expect(sanitizeSettingValue(schema, o.value)).toBe(o.value);
  });

  it('customPages lists the theme pages with their titles', () => {
    let t = ok(addPage(fixture(), { handle: 'sale', title: 'Diwali Sale', starter: 'blank' }));
    t = ok(addPage(t, { handle: 'about-us', title: '', starter: 'blank' }));
    expect(customPages(t)).toEqual([
      { key: 'page.about-us', handle: 'about-us', title: 'about-us' },
      { key: 'page.sale', handle: 'sale', title: 'Diwali Sale' },
    ]);
  });

  it('openTemplateKey falls back to home when the open page disappears (undo, delete, restore)', () => {
    const base = fixture();
    const t = ok(addPage(base, { handle: 'sale', title: 'Sale', starter: 'blank' }));
    expect(openTemplateKey(t, 'page.sale')).toBe('page.sale');
    expect(openTemplateKey(base, 'page.sale')).toBe('home');
    expect(openTemplateKey(ok(removePage(t, 'page.sale')), 'page.sale')).toBe('home');
    expect(openTemplateKey(base, 'catalog')).toBe('catalog');
    // Whatever it returns is an option of the switcher.
    for (const key of ['home', 'product', 'page.sale', 'page.gone']) {
      expect(templateOptions(base).map((o) => o.key)).toContain(openTemplateKey(base, key));
    }
  });
});
