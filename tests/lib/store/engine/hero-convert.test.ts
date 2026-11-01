import { convertLegacyHeroSections } from '@/lib/store/engine/hero-convert';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import { presetTheme } from '@/lib/store/engine/presets';
import { getSectionSchema } from '@/lib/store/engine/registry';
import { CONTENT_BLOCKS } from '@/lib/store/engine/content-blocks';
import type { ThemePreset } from '@/lib/store/engine/types';

type Raw = Record<string, any>;

const ctx = { businessName: 'Shop', tagline: 'Hello there', accent: '#2563eb', logoUrl: null, heroUrl: null } as never;

const legacy = (type: string, settings: object, extra: object = {}): Raw => ({
  templates: { home: { order: ['a'], sections: { a: { type, settings, blocks: {}, block_order: [], ...extra } } } },
});

const section = (out: Raw) => out.templates.home.sections.a;

describe('convertLegacyHeroSections: Hero banner', () => {
  it('converts an old banner', () => {
    const s = section(
      convertLegacyHeroSections(
        legacy('image-banner', { image: '/x.webp', heading: 'Sale', description: 'Up to 50%', button_text: 'Shop', link: '/catalog', text_position: 'center', height: 'large' }),
      ),
    );
    expect(s.block_order).toEqual(['heading-1', 'text-1', 'button-1']);
    expect(s.blocks['heading-1']).toEqual({ type: 'heading', settings: { text: 'Sale' } });
    expect(s.blocks['text-1']).toEqual({ type: 'text', settings: { content: '<p>Up to 50%</p>' } });
    expect(s.blocks['button-1']).toEqual({ type: 'button', settings: { label: 'Shop', link: '/catalog' } });
    expect(s.settings).toEqual({ image: '/x.webp', height: 'large', position: 'middle-center', align: 'center' });
    // The darkening is the schema default (40, the old fixed value): nothing is written.
    expect(s.settings).not.toHaveProperty('overlay');
    for (const k of ['heading', 'description', 'button_text', 'link', 'text_position']) expect(s.settings).not.toHaveProperty(k);
  });

  it('escapes HTML in the description before wrapping it in a paragraph', () => {
    const s = section(convertLegacyHeroSections(legacy('image-banner', { description: '<b>5 & 6</b> "off"' })));
    expect(s.blocks['text-1'].settings.content).toBe('<p>&lt;b&gt;5 &amp; 6&lt;/b&gt; &quot;off&quot;</p>');
  });

  it('a button without a link keeps only its label; a missing button text is the old default "Shop now"', () => {
    expect(section(convertLegacyHeroSections(legacy('image-banner', { button_text: 'Go' }))).blocks['button-1']).toEqual({
      type: 'button',
      settings: { label: 'Go' },
    });
    expect(section(convertLegacyHeroSections(legacy('image-banner', { link: '/x' }))).blocks['button-1']).toEqual({
      type: 'button',
      settings: { label: 'Shop now', link: '/x' },
    });
    // No link stored: the button has no link key, so it falls back as before.
    expect(section(convertLegacyHeroSections(legacy('image-banner', { heading: 'Sale' }))).blocks['button-1']).toEqual({
      type: 'button',
      settings: { label: 'Shop now' },
    });
  });

  it('an explicitly empty button text means no button, and the result runs once', () => {
    const out = convertLegacyHeroSections(legacy('image-banner', { heading: 'Sale', button_text: '' }));
    expect(section(out).block_order).toEqual(['heading-1']);
    expect(convertLegacyHeroSections(out)).toEqual(out);
    const withDefault = convertLegacyHeroSections(legacy('image-banner', { heading: 'Sale' }));
    expect(convertLegacyHeroSections(withDefault)).toEqual(withDefault);
  });

  it('an empty old banner gets no blocks but its position', () => {
    const s = section(convertLegacyHeroSections(legacy('image-banner', { heading: '', description: '', button_text: '', link: '', text_position: 'right' })));
    expect(s.block_order).toEqual([]);
    expect(s.blocks).toEqual({});
    expect(s.settings).toEqual({ position: 'middle-right', align: 'right' });
  });

  it('a banner with blocks is left alone', () => {
    const raw = legacy('image-banner', { heading: 'Old', text_position: 'left' }, { blocks: { 'heading-1': { type: 'heading', settings: { text: 'New' } } }, block_order: ['heading-1'] });
    expect(convertLegacyHeroSections(raw)).toEqual(raw);
  });

  it('a banner with none of the old keys is left alone', () => {
    const raw = legacy('image-banner', { image: '/x.webp', position: 'top-left' });
    expect(convertLegacyHeroSections(raw)).toEqual(raw);
  });

  it('walks the header group, the footer group and custom pages too', () => {
    const banner = { type: 'image-banner', settings: { heading: 'H' }, blocks: {}, block_order: [] };
    const tpl = { order: ['a'], sections: { a: banner } };
    const out = convertLegacyHeroSections({ header_group: tpl, footer_group: tpl, templates: { 'page.x': tpl } });
    for (const t of [out.header_group, out.footer_group, out.templates['page.x']]) expect(t.sections.a.block_order).toEqual(['heading-1', 'button-1']);
  });

  it('is pure: the input is untouched, and other section types pass through', () => {
    const raw = legacy('image-banner', { heading: 'H' });
    const copy = JSON.parse(JSON.stringify(raw));
    convertLegacyHeroSections(raw);
    expect(raw).toEqual(copy);
    const other = legacy('rich-text', { heading: 'H' });
    expect(convertLegacyHeroSections(other)).toEqual(other);
  });

  it('does not throw on malformed input', () => {
    for (const raw of [{}, { templates: null }, { templates: { home: null } }, { templates: { home: { sections: { a: 5 } } } }, { header_group: 'x' }]) {
      expect(() => convertLegacyHeroSections(raw as Raw)).not.toThrow();
    }
  });
});

describe('convertLegacyHeroSections: Slideshow', () => {
  const slides = {
    blocks: {
      'slide-1': { type: 'slide', settings: { heading: 'A' } },
      'slide-2': { type: 'slide', settings: { heading: 'B', overlay: 0 } },
    },
    block_order: ['slide-1', 'slide-2'],
  };

  it('copies slideshow overlay and text colour into every slide', () => {
    const s = section(convertLegacyHeroSections(legacy('slideshow', { layout: 'full', overlay: 30, text_color: '#ffffff' }, slides)));
    expect(s.settings).toEqual({ layout: 'full' });
    expect(s.blocks['slide-1'].settings).toEqual({ heading: 'A', overlay: 30, text_color: '#ffffff', position: 'middle-left' });
    // A slide that already had its own darkening keeps it (0 is a value), and still gets the colour.
    expect(s.blocks['slide-2'].settings).toEqual({ heading: 'B', overlay: 0, text_color: '#ffffff', position: 'middle-left' });
  });

  it('keeps a position a slide already has, and a text colour it already has', () => {
    const own = {
      blocks: { 'slide-1': { type: 'slide', settings: { position: 'top-right', text_color: '#000000' } } },
      block_order: ['slide-1'],
    };
    const s = section(convertLegacyHeroSections(legacy('slideshow', { overlay: 20, text_color: '#ffffff' }, own)));
    expect(s.blocks['slide-1'].settings).toEqual({ position: 'top-right', text_color: '#000000', overlay: 20 });
  });

  it('an empty text colour is not copied', () => {
    const s = section(convertLegacyHeroSections(legacy('slideshow', { text_color: '' }, slides)));
    expect(s.blocks['slide-1'].settings).not.toHaveProperty('text_color');
    expect(s.settings).toEqual({});
  });

  it('a slideshow without the old keys is left alone, and running twice changes nothing', () => {
    const plain = legacy('slideshow', { layout: 'full' }, slides);
    expect(convertLegacyHeroSections(plain)).toEqual(plain);
    const once = convertLegacyHeroSections(legacy('slideshow', { overlay: 30 }, slides));
    expect(convertLegacyHeroSections(once)).toEqual(once);
  });
});

describe('through the sanitiser', () => {
  it('runs once: sanitising twice equals sanitising once', () => {
    const raw = {
      templates: {
        home: {
          order: ['b', 's'],
          sections: {
            b: { type: 'image-banner', settings: { image: '/b.webp', heading: 'Sale', description: 'Up to 50%', button_text: 'Shop', link: '/catalog', text_position: 'center' }, blocks: {}, block_order: [] },
            s: {
              type: 'slideshow',
              settings: { overlay: 30, text_color: '#ffffff' },
              blocks: { 'slide-1': { type: 'slide', settings: { heading: 'A' } } },
              block_order: ['slide-1'],
            },
          },
        },
      },
    };
    const once = sanitizeThemeData(raw);
    expect(sanitizeThemeData(once)).toEqual(once);
    const b = once.templates.home.sections.b;
    expect(b.block_order).toEqual(['heading-1', 'text-1', 'button-1']);
    expect(b.settings).toEqual({ image: '/b.webp', position: 'middle-center', align: 'center' });
    const s = once.templates.home.sections.s;
    expect(s.settings).toEqual({});
    expect(s.blocks['slide-1'].settings).toEqual({ heading: 'A', overlay: 30, text_color: '#ffffff', position: 'middle-left' });
  });

  it('a third button block is dropped by the sanitiser', () => {
    const banner = {
      type: 'image-banner',
      settings: {},
      blocks: {
        'button-1': { type: 'button', settings: { label: 'One' } },
        'button-2': { type: 'button', settings: { label: 'Two' } },
        'button-3': { type: 'button', settings: { label: 'Three' } },
        'heading-1': { type: 'heading', settings: { text: 'H' } },
      },
      block_order: ['button-1', 'button-2', 'button-3', 'heading-1'],
    };
    const out = sanitizeThemeData({ templates: { home: { order: ['a'], sections: { a: banner } } } }).templates.home.sections.a;
    expect(out.block_order).toEqual(['button-1', 'button-2', 'heading-1']);
  });

  it('keeps at most eight blocks, and drops block types the hero does not offer', () => {
    const blocks: Raw = {};
    const order: string[] = [];
    for (let i = 1; i <= 9; i++) {
      blocks[`heading-${i}`] = { type: 'heading', settings: { text: `H${i}` } };
      order.push(`heading-${i}`);
    }
    blocks['quote-1'] = { type: 'quote', settings: {} };
    order.unshift('quote-1');
    const out = sanitizeThemeData({ templates: { home: { order: ['a'], sections: { a: { type: 'image-banner', settings: {}, blocks, block_order: order } } } } }).templates.home.sections.a;
    expect(out.block_order).toHaveLength(8);
    expect(out.block_order).not.toContain('quote-1');
  });

  it('drops an unknown position and an out-of-range darkening to the defaults', () => {
    const out = sanitizeThemeData({
      templates: { home: { order: ['a'], sections: { a: { type: 'image-banner', settings: { position: 'nowhere', overlay: 500, motion: 'spin' }, blocks: {}, block_order: [] } } } },
    }).templates.home.sections.a;
    expect(out.settings.position).toBeUndefined();
    expect(out.settings.motion).toBeUndefined();
    expect(out.settings.overlay).toBe(80);
  });
});

describe('schemas', () => {
  it('lists the hero as "Hero banner" with at most 2 buttons and 8 blocks, and does not change the shared blocks', () => {
    const schema = getSectionSchema('image-banner')!;
    expect(schema.name).toBe('Hero banner');
    expect(schema.max_blocks).toBe(8);
    expect(schema.blocks!.map((b) => b.type)).toEqual(['eyebrow', 'heading', 'text', 'button']);
    expect(schema.blocks!.find((b) => b.type === 'button')!.limit).toBe(2);
    // Image with text and Rich text share the content blocks: no button cap or rename leaked into them.
    expect(CONTENT_BLOCKS.find((b) => b.type === 'button')!.limit).toBeUndefined();
    expect(CONTENT_BLOCKS.find((b) => b.type === 'eyebrow')!.name).toBe('Eyebrow');
    expect(getSectionSchema('image-with-text')!.blocks!.find((b) => b.type === 'button')!.limit).toBeUndefined();
  });

  it('the slideshow drops its section-wide darkening and text colour and gains text_below_mobile', () => {
    const ids = getSectionSchema('slideshow')!.settings.map((s) => s.id);
    expect(ids).not.toContain('overlay');
    expect(ids).not.toContain('text_color');
    expect(ids).toEqual(expect.arrayContaining(['autoplay', 'speed', 'height', 'image_fit', 'layout', 'text_below_mobile']));
  });
});

describe('presets', () => {
  it.each(['blank', 'quick', 'grocery', 'khatario', 'heritage', 'studio'])('preset %s sanitises unchanged', (name) => {
    const p = presetTheme(name as ThemePreset, ctx);
    expect(sanitizeThemeData(p)).toEqual(p);
  });
});
