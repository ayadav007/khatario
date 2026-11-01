import { convertLegacyMenus } from '@/lib/store/engine/menus-sanitize';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import { presetTheme } from '@/lib/store/engine/presets';
import type { ThemePreset } from '@/lib/store/engine/types';

type Raw = Record<string, unknown>;

function legacyTheme(menus?: unknown): Raw {
  const settings: Raw = {};
  if (menus !== undefined) settings.menus = menus;
  return {
    settings,
    header_group: {
      order: ['header'],
      sections: {
        header: {
          type: 'header',
          settings: { show_search: true },
          blocks: {
            a: { type: 'menu_link', settings: { label: 'Sale', link: '/sale', highlight: true } },
            b: { type: 'menu_link', settings: { label: 'Hidden', link: '/hidden' }, disabled: true },
            c: { type: 'menu_link', settings: { label: 'All', link: '/catalog' } },
          },
          block_order: ['a', 'b', 'c'],
        },
      },
    },
    footer_group: {
      order: ['footer'],
      sections: {
        footer: {
          type: 'footer',
          settings: {},
          blocks: {
            x: { type: 'link_column', settings: { heading: 'Help', links: 'Contact|/pages/contact\nbad line\nFAQ|/pages/faq' } },
            y: { type: 'link_column', settings: { heading: 'Off', links: 'Nope|/nope' }, disabled: true },
          },
          block_order: ['x', 'y'],
        },
      },
    },
    templates: {},
  };
}

describe('convertLegacyMenus / sanitizeThemeData', () => {
  it('header links become the main menu', () => {
    const out = sanitizeThemeData(legacyTheme());
    expect(out.settings.menus[0]).toEqual({
      id: 'main',
      name: 'Main menu',
      items: [
        { id: 'm1', label: 'Sale', link: '/sale', highlight: true },
        { id: 'm2', label: 'All', link: '/catalog' },
      ],
    });
    const header = out.header_group.sections.header;
    expect(header.settings.menu).toBe('main');
    expect(header.blocks).toEqual({});
    expect(header.block_order).toEqual([]);
  });

  it('footer columns become the footer menu', () => {
    const out = sanitizeThemeData(legacyTheme());
    const footerMenu = out.settings.menus.find((m) => m.id === 'footer');
    expect(footerMenu?.name).toBe('Footer menu');
    expect(footerMenu?.items).toHaveLength(1);
    const help = footerMenu!.items[0];
    expect(help.label).toBe('Help');
    expect(help.link).toBe('');
    expect(help.children?.map((c) => [c.label, c.link])).toEqual([
      ['Contact', '/pages/contact'],
      ['FAQ', '/pages/faq'],
    ]);
    const footer = out.footer_group.sections.footer;
    expect(footer.settings.menu).toBe('footer');
    expect(footer.blocks).toEqual({});
  });

  it('footer lines skip a missing pipe, an empty label and an unsafe link', () => {
    const raw = legacyTheme() as any;
    raw.footer_group.sections.footer.blocks.x.settings.links = 'Refund|/refund\nBad|javascript:x\nno pipe\nAbs|https://example.com/a\n|/nolabel';
    const footerMenu = sanitizeThemeData(raw).settings.menus.find((m) => m.id === 'footer')!;
    expect(footerMenu.items[0].children!.map((c) => [c.label, c.link])).toEqual([
      ['Refund', '/refund'],
      ['Abs', 'https://example.com/a'],
    ]);
  });

  it('runs once', () => {
    const once = sanitizeThemeData(legacyTheme());
    expect(sanitizeThemeData(once)).toEqual(once);
    expect(sanitizeThemeData(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it('converts when menus is null or an object', () => {
    for (const bad of [null, { id: 'main' }, 'x', 5]) {
      const out = sanitizeThemeData(legacyTheme(bad));
      expect(out.settings.menus.map((m) => m.id)).toEqual(['main', 'footer']);
      expect(out.settings.menus[0].items.map((i) => i.label)).toEqual(['Sale', 'All']);
    }
  });

  it('converts when menus is an empty array', () => {
    const out = sanitizeThemeData(legacyTheme([]));
    expect(out.settings.menus.map((m) => m.id)).toEqual(['main', 'footer']);
    expect(out.settings.menus[0].items.map((i) => i.label)).toEqual(['Sale', 'All']);
    expect(out.header_group.sections.header.settings.menu).toBe('main');
  });

  it('creates empty main and footer menus when there were no blocks', () => {
    const out = sanitizeThemeData({ settings: {}, header_group: { order: [], sections: {} }, footer_group: { order: [], sections: {} }, templates: {} });
    expect(out.settings.menus).toEqual([
      { id: 'main', name: 'Main menu', items: [] },
      { id: 'footer', name: 'Footer menu', items: [] },
    ]);
  });

  it('leaves a theme with menus and no old blocks alone', () => {
    const mine = [{ id: 'nav', name: 'Nav', items: [{ id: 'z', label: 'Mine', link: '/mine' }] }];
    const raw = legacyTheme(mine) as any;
    raw.header_group.sections.header.blocks = {};
    raw.header_group.sections.header.block_order = [];
    raw.footer_group.sections.footer.blocks = {};
    raw.footer_group.sections.footer.block_order = [];
    const out = convertLegacyMenus(raw) as any;
    expect(out.settings.menus).toEqual(mine);
    expect(out.header_group).toBe(raw.header_group);
    expect(out.footer_group).toBe(raw.footer_group);
  });

  it('legacy blocks + a user menu keeps the links', () => {
    // A theme saved before menus, opened in the editor, and a menu added before the first save.
    const mine = [{ id: 'menu-x', name: 'Promo', items: [{ id: 'z', label: 'Mine', link: '/mine' }] }];
    const out = sanitizeThemeData(legacyTheme(mine));
    expect(out.settings.menus.map((m) => m.id)).toEqual(['menu-x', 'main', 'footer']);
    expect(out.settings.menus[0]).toEqual(mine[0]);
    expect(out.settings.menus[1].items.map((i) => i.label)).toEqual(['Sale', 'All']);
    expect(out.settings.menus[2].items[0].children!.map((c) => c.label)).toEqual(['Contact', 'FAQ']);
    const header = out.header_group.sections.header;
    expect(header.settings.menu).toBe('main');
    expect(header.blocks).toEqual({});
    expect(header.block_order).toEqual([]);
    const footer = out.footer_group.sections.footer;
    expect(footer.settings.menu).toBe('footer');
    expect(footer.blocks).toEqual({});
    expect(sanitizeThemeData(out)).toEqual(out);
  });

  it('legacy blocks next to taken main and footer ids get fresh menu ids, and a chosen menu stays', () => {
    const mine = [
      { id: 'main', name: 'Mine', items: [{ id: 'z', label: 'Mine', link: '/mine' }] },
      { id: 'footer', name: 'My footer', items: [] },
    ];
    const raw = legacyTheme(mine) as any;
    raw.header_group.sections.header.settings.menu = 'main';
    const out = sanitizeThemeData(raw);
    const ids = out.settings.menus.map((m) => m.id);
    expect(ids.slice(0, 2)).toEqual(['main', 'footer']);
    expect(ids).toHaveLength(4);
    const [, , headerMenu, footerMenu] = out.settings.menus;
    expect(headerMenu.id).not.toBe('main');
    expect(footerMenu.id).not.toBe('footer');
    expect(headerMenu.items.map((i) => i.label)).toEqual(['Sale', 'All']);
    expect(footerMenu.items[0].label).toBe('Help');
    // The header already chose a menu, so it keeps it; the footer had none and gets the converted links.
    expect(out.header_group.sections.header.settings.menu).toBe('main');
    expect(out.footer_group.sections.footer.settings.menu).toBe(footerMenu.id);
    expect(out.header_group.sections.header.blocks).toEqual({});
    expect(sanitizeThemeData(out)).toEqual(out);
  });

  it('a footer column without a heading keeps its links as top-level links', () => {
    const raw = legacyTheme() as any;
    raw.footer_group.sections.footer.blocks.x.settings.heading = '  ';
    const footerMenu = sanitizeThemeData(raw).settings.menus.find((m) => m.id === 'footer')!;
    expect(footerMenu.items.map((i) => [i.label, i.link, i.children])).toEqual([
      ['Contact', '/pages/contact', undefined],
      ['FAQ', '/pages/faq', undefined],
    ]);
  });

  it('does not change its input', () => {
    const raw = legacyTheme();
    const copy = JSON.parse(JSON.stringify(raw));
    const converted = convertLegacyMenus(raw);
    expect(raw).toEqual(copy);
    expect(converted).not.toBe(raw);
  });

  it.each<ThemePreset>(['studio', 'quick', 'grocery', 'khatario', 'blank'])('the %s preset sanitises to main and footer menus', (p) => {
    const out = sanitizeThemeData(presetTheme(p, { businessName: 'Rose Mart', tagline: 'Fresh' }));
    const ids = out.settings.menus.map((m) => m.id);
    expect(ids).toContain('main');
    expect(ids).toContain('footer');
    expect(out.settings.menus.find((m) => m.id === 'main')!.items.length).toBeGreaterThan(0);
  });
});
