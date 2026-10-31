import {
  ENGINE_LIMITS,
  ID_RE,
  newId,
  sanitizeSection,
  sanitizeTemplate,
  sanitizeThemeData,
  themeTooLarge,
} from '@/lib/store/engine/sanitize';
import { SECTION_SCHEMAS } from '@/lib/store/engine/registry';
import { DEFAULT_COLOR_SCHEMES } from '@/lib/store/engine/color-schemes';
import type { TemplateKind } from '@/lib/store/engine/types';

const sec = (type: string, extra: Record<string, unknown> = {}) => ({ type, settings: {}, blocks: {}, block_order: [], ...extra });

describe('sanitizeTemplate', () => {
  it('drops unknown section and block types', () => {
    const t = sanitizeTemplate(
      {
        order: ['a', 'b'],
        sections: {
          a: sec('nope'),
          b: sec('slideshow', {
            blocks: { x: { type: 'slide', settings: {} }, y: { type: 'bogus', settings: {} } },
            block_order: ['x', 'y'],
          }),
        },
      },
      'home',
    );
    expect(t.order).toEqual(['b']);
    expect(Object.keys(t.sections)).toEqual(['b']);
    expect(t.sections.b.block_order).toEqual(['x']);
    expect(Object.keys(t.sections.b.blocks)).toEqual(['x']);
  });

  it('removes order ids without a section and sections not in order', () => {
    const t = sanitizeTemplate(
      { order: ['a', 'ghost', 'a'], sections: { a: sec('rich-text'), orphan: sec('rich-text') } },
      'home',
    );
    expect(t.order).toEqual(['a']);
    expect(Object.keys(t.sections)).toEqual(['a']);
  });

  it('drops a header section placed in the home template', () => {
    const t = sanitizeTemplate({ order: ['h'], sections: { h: sec('header') } }, 'home');
    expect(t.order).toEqual([]);
    expect(sanitizeTemplate({ order: ['h'], sections: { h: sec('header') } }, 'header').order).toEqual(['h']);
  });

  it('keeps only one header (limit 1)', () => {
    const t = sanitizeTemplate({ order: ['h1', 'h2'], sections: { h1: sec('header'), h2: sec('header') } }, 'header');
    expect(t.order).toEqual(['h1']);
    expect(Object.keys(t.sections)).toEqual(['h1']);
  });

  it('caps sections at 25 and blocks at schema max_blocks', () => {
    const order: string[] = [];
    const sections: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) {
      order.push(`s${i}`);
      sections[`s${i}`] = sec('rich-text');
    }
    const t = sanitizeTemplate({ order, sections }, 'home');
    expect(t.order).toHaveLength(ENGINE_LIMITS.sectionsPerTemplate);

    const blocks: Record<string, unknown> = {};
    const blockOrder: string[] = [];
    for (let i = 0; i < 20; i++) {
      blocks[`b${i}`] = { type: 'quote', settings: {} };
      blockOrder.push(`b${i}`);
    }
    const max = SECTION_SCHEMAS.testimonials.max_blocks as number;
    const s = sanitizeSection(sec('testimonials', { blocks, block_order: blockOrder }), 'home');
    expect(s?.block_order).toHaveLength(max);
    expect(Object.keys(s?.blocks ?? {})).toHaveLength(max);
  });

  it('rejects bad ids', () => {
    const t = sanitizeTemplate(
      { order: ['Bad Id!', 'good-id', '__proto__'], sections: { 'Bad Id!': sec('rich-text'), 'good-id': sec('rich-text'), ['__proto__']: sec('rich-text') } },
      'home',
    );
    expect(t.order).toEqual(['good-id']);
  });

  it('drops color_scheme that does not exist', () => {
    const data = sanitizeThemeData({
      templates: {
        home: {
          order: ['a', 'b'],
          sections: { a: sec('rich-text', { color_scheme: 'scheme-2' }), b: sec('rich-text', { color_scheme: 'scheme-99' }) },
        },
      },
    });
    expect(data.templates.home.sections.a.color_scheme).toBe('scheme-2');
    expect(data.templates.home.sections.b.color_scheme).toBeUndefined();
  });

  it('sanitises css_class and cuts custom_css', () => {
    const s = sanitizeSection(sec('rich-text', { css_class: 'ok-one <bad>', custom_css: 'a'.repeat(5000) }), 'home');
    expect(s?.css_class).toBe('ok-one');
    expect(s?.custom_css).toHaveLength(3000);
  });
});

describe('section custom colours', () => {
  it('keeps valid hex for known fields only, lower-cased, and drops an empty set', () => {
    const s = sanitizeSection(
      { type: 'rich-text', settings: {}, blocks: {}, block_order: [], custom_colors: { background: '#FF7028', text: 'red', bogus: '#000000', card: '#fff' } },
      'home',
    );
    expect(s?.custom_colors).toEqual({ background: '#ff7028', card: '#fff' });
    const none = sanitizeSection({ type: 'rich-text', settings: {}, blocks: {}, block_order: [], custom_colors: { text: 'javascript:x' } }, 'home');
    expect(none && 'custom_colors' in none).toBe(false);
  });
});

describe('sanitizeThemeData', () => {
  it('rejects reserved and malformed page handles, keeps page.diwali-sale with title', () => {
    const page = { title: 'Diwali sale', order: ['a'], sections: { a: sec('rich-text') } };
    const data = sanitizeThemeData({
      templates: {
        'page.cart': page,
        'page.Bad Handle': page,
        'page.-x': page,
        'page.diwali-sale': page,
        'junk': page,
      },
    });
    expect(Object.keys(data.templates).sort()).toEqual(['catalog', 'home', 'page.diwali-sale', 'product']);
    expect(data.templates['page.diwali-sale'].title).toBe('Diwali sale');
    expect(data.templates['page.diwali-sale'].order).toEqual(['a']);
  });

  it('fills missing templates', () => {
    const data = sanitizeThemeData({});
    for (const k of ['home', 'product', 'catalog']) expect(data.templates[k]).toEqual({ order: [], sections: {} });
  });

  it('returns a valid empty theme for garbage', () => {
    for (const g of ['garbage', null, 5, [], undefined]) {
      const data = sanitizeThemeData(g);
      expect(data.settings.color_schemes).toEqual(DEFAULT_COLOR_SCHEMES);
      expect(data.settings.font_heading).toBe('outfit');
      expect(data.settings.font_body).toBe('inter');
      expect(data.settings.button_radius).toBe(10);
      expect(data.settings.card_style).toBe('bordered');
      expect(data.settings.phone_kit).toBe(true);
      expect(data.header_group).toEqual({ order: [], sections: {} });
      expect(data.footer_group).toEqual({ order: [], sections: {} });
    }
  });

  it('sanitises theme settings', () => {
    const data = sanitizeThemeData({
      settings: {
        font_heading: 'comic-sans',
        font_body: 'nunito',
        button_radius: 99,
        card_style: 'weird',
        phone_kit: false,
        custom_css: 'x'.repeat(9000),
        social: { instagram: 'https://instagram.com/x', facebook: 'javascript:alert(1)' },
      },
    });
    expect(data.settings.font_heading).toBe('outfit');
    expect(data.settings.font_body).toBe('nunito');
    expect(data.settings.button_radius).toBe(32);
    expect(data.settings.card_style).toBe('bordered');
    expect(data.settings.phone_kit).toBe(false);
    expect(data.settings.custom_css).toHaveLength(8000);
    expect(data.settings.social.instagram).toBe('https://instagram.com/x');
    expect(data.settings.social.facebook).toBe('');
  });

  it('caps custom pages at 30', () => {
    const templates: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) templates[`page.p${i}`] = { order: [], sections: {} };
    const data = sanitizeThemeData({ templates });
    expect(Object.keys(data.templates).filter((k) => k.startsWith('page.'))).toHaveLength(ENGINE_LIMITS.customPages);
  });

  it('is idempotent for a fixture with every section type', () => {
    const kindFor = (types: TemplateKind[]) => types[0];
    const groups: Record<string, { order: string[]; sections: Record<string, unknown> }> = {
      home: { order: [], sections: {} },
      header: { order: [], sections: {} },
      footer: { order: [], sections: {} },
    };
    for (const schema of Object.values(SECTION_SCHEMAS)) {
      const kind = kindFor(schema.templates);
      const target = kind === 'header' || kind === 'footer' ? groups[kind] : groups.home;
      const id = `s-${schema.type}`.slice(0, 32);
      const blocks: Record<string, unknown> = {};
      const block_order: string[] = [];
      (schema.presets[0]?.blocks ?? []).forEach((b, i) => {
        blocks[`b${i + 1}`] = { type: b.type, settings: b.settings ?? {} };
        block_order.push(`b${i + 1}`);
      });
      target.order.push(id);
      target.sections[id] = { type: schema.type, settings: schema.presets[0]?.settings ?? {}, blocks, block_order, color_scheme: 'scheme-3', css_class: 'x y', custom_css: '.a{color:red}' };
    }
    const raw = {
      settings: { font_heading: 'fraunces', button_radius: 4, social: { instagram: 'https://instagram.com/a' } },
      header_group: groups.header,
      footer_group: groups.footer,
      templates: { home: groups.home, 'page.about-us': { title: 'About', order: [], sections: {} } },
    };
    const once = sanitizeThemeData(raw);
    expect(once.templates.home.order.length).toBeGreaterThan(5);
    expect(once.header_group.order).toHaveLength(2);
    expect(sanitizeThemeData(once)).toEqual(once);
  });

  it('every schema preset survives sanitising unchanged', () => {
    for (const schema of Object.values(SECTION_SCHEMAS)) {
      for (const preset of schema.presets) {
        const blocks: Record<string, { type: string; settings: Record<string, unknown> }> = {};
        const block_order: string[] = [];
        (preset.blocks ?? []).forEach((b, i) => {
          blocks[`b${i + 1}`] = { type: b.type, settings: b.settings ?? {} };
          block_order.push(`b${i + 1}`);
        });
        const input = { type: schema.type, settings: preset.settings ?? {}, blocks, block_order };
        const out = sanitizeSection(input, schema.templates[0]);
        expect({ type: schema.type, preset: preset.name, settings: out?.settings }).toEqual({ type: schema.type, preset: preset.name, settings: input.settings });
        expect({ type: schema.type, preset: preset.name, blocks: out?.blocks }).toEqual({ type: schema.type, preset: preset.name, blocks: input.blocks });
        expect(out?.block_order).toEqual(block_order);
      }
    }
  });
});

describe('themeTooLarge', () => {
  it('is true for a theme with a 600 KB rich text', () => {
    const data = sanitizeThemeData({});
    expect(themeTooLarge(data)).toBe(false);
    data.templates.home = {
      order: ['a'],
      sections: { a: { type: 'rich-text', settings: { content: 'x'.repeat(600 * 1024) }, blocks: {}, block_order: [] } },
    };
    expect(themeTooLarge(data)).toBe(true);
  });
});

describe('newId', () => {
  it('produces ids that match ID_RE', () => {
    expect(newId('slideshow')).toMatch(/^slideshow-[a-z0-9]{6}$/);
    expect(newId()).toMatch(/^id-[a-z0-9]{6}$/);
    expect(ID_RE.test(newId('x'.repeat(60)))).toBe(true);
    expect(newId('x'.repeat(60))).toHaveLength(32);
  });
});

describe('section label', () => {
  it('sanitizeSection keeps a trimmed label up to 40 chars and drops empty or non-string labels', () => {
    expect(sanitizeSection({ ...sec('rich-text'), label: '  My intro  ' }, 'home')?.label).toBe('My intro');
    expect(sanitizeSection({ ...sec('rich-text'), label: 'x'.repeat(60) }, 'home')?.label).toBe('x'.repeat(40));
    expect(sanitizeSection({ ...sec('rich-text'), label: '   ' }, 'home')).not.toHaveProperty('label');
    expect(sanitizeSection({ ...sec('rich-text'), label: 5 }, 'home')).not.toHaveProperty('label');
    expect(sanitizeSection(sec('rich-text'), 'home')).not.toHaveProperty('label');
  });
});

describe('ids unique across groups (D12)', () => {
  const rt = (title: string) => sec('rich-text', { settings: { content: title } });
  it('sanitizeThemeData drops a section whose id repeats an earlier group id', () => {
    const data = sanitizeThemeData({
      header_group: { order: ['header'], sections: { header: sec('header') } },
      footer_group: { order: ['footer'], sections: { footer: sec('footer') } },
      templates: {
        home: { order: ['header', 'a', 'footer'], sections: { header: rt('h'), a: rt('a'), footer: rt('f') } },
      },
    });
    expect(data.header_group.order).toEqual(['header']);
    expect(data.header_group.sections.header.type).toBe('header');
    expect(data.footer_group.order).toEqual(['footer']);
    expect(data.footer_group.sections.footer.type).toBe('footer');
    expect(data.templates.home.order).toEqual(['a']);
    expect(Object.keys(data.templates.home.sections)).toEqual(['a']);
  });

  it('keeps the same id across different templates', () => {
    const data = sanitizeThemeData({
      templates: {
        home: { order: ['a'], sections: { a: rt('1') } },
        'page.sale': { order: ['a'], sections: { a: rt('2') } },
      },
    });
    expect(data.templates.home.order).toEqual(['a']);
    expect(data.templates['page.sale'].order).toEqual(['a']);
  });

  it('the footer group keeps its id over a template section', () => {
    const data = sanitizeThemeData({
      footer_group: { order: ['x'], sections: { x: sec('footer') } },
      templates: { home: { order: ['x'], sections: { x: rt('1') } } },
    });
    expect(data.templates.home.order).toEqual([]);
    expect(data.footer_group.order).toEqual(['x']);
  });
});

describe('theme settings image rule', () => {
  it('logo_url and favicon_url use the image rule', () => {
    const s = sanitizeThemeData({ settings: { logo_url: '#x', favicon_url: '#y' } }).settings;
    expect(s.logo_url).toBe('');
    expect(s.favicon_url).toBe('');
    const ok = sanitizeThemeData({ settings: { logo_url: '/uploads/a.png', favicon_url: 'https://x.com/f.ico' } }).settings;
    expect(ok.logo_url).toBe('/uploads/a.png');
    expect(ok.favicon_url).toBe('https://x.com/f.ico');
  });
});

describe('duplicate ids and per-type limits', () => {
  it('a dropped duplicate does not use up its type limit', () => {
    // footer is a limit-1 type; its first copy repeats the header id and is dropped, the second is kept.
    const data = sanitizeThemeData({
      header_group: { order: ['dup'], sections: { dup: sec('header') } },
      footer_group: { order: ['dup', 'ok'], sections: { dup: sec('footer'), ok: sec('footer') } },
    });
    expect(data.footer_group.order).toEqual(['ok']);
  });
});
