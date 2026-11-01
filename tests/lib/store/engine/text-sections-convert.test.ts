import { convertLegacyTextSections } from '@/lib/store/engine/text-sections-convert';
import fs from 'fs';
import path from 'path';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';

type Raw = Record<string, any>;

const legacy = (type: string, settings: object): Raw => ({
  templates: { home: { order: ['a'], sections: { a: { type, settings, blocks: {}, block_order: [] } } } },
});

describe('convertLegacyTextSections', () => {
  it('turns heading, description and button into blocks in that order and drops the old keys', () => {
    const out = convertLegacyTextSections(
      legacy('image-with-text', { image: '/x.webp', heading: 'Our story', description: '<p>Hi</p>', button_text: 'Read', link: '/pages/about', image_side: 'right' }),
    );
    const s = out.templates.home.sections.a;
    expect(s.block_order).toEqual(['heading-1', 'text-1', 'button-1']);
    // Only the values the old settings held: size and style stay unset so the schema defaults apply (and so a
    // converted old preset equals the rewritten preset).
    expect(s.blocks['heading-1']).toEqual({ type: 'heading', settings: { text: 'Our story' } });
    expect(s.blocks['text-1']).toEqual({ type: 'text', settings: { content: '<p>Hi</p>' } });
    expect(s.blocks['button-1']).toEqual({ type: 'button', settings: { label: 'Read', link: '/pages/about' } });
    expect(s.settings).toEqual({ image: '/x.webp', image_side: 'right' });
  });

  it('rich-text uses content and align; empty values make no block', () => {
    const s = convertLegacyTextSections(legacy('rich-text', { heading: '', content: '<p>x</p>', align: 'left' })).templates.home.sections.a;
    expect(s.block_order).toEqual(['text-1']);
    expect(s.settings).toEqual({ align: 'left' });
  });

  it('a button without a link keeps only its label; a link without a label makes no button', () => {
    const a = convertLegacyTextSections(legacy('image-with-text', { button_text: 'Go' })).templates.home.sections.a;
    expect(a.blocks['button-1']).toEqual({ type: 'button', settings: { label: 'Go' } });
    const b = convertLegacyTextSections(legacy('image-with-text', { link: '/x' })).templates.home.sections.a;
    expect(b.block_order).toEqual([]);
    expect(b.settings).toEqual({});
  });

  it('a section that already has blocks gets its old content as blocks in front of them, under free ids; running twice changes nothing', () => {
    const half = legacy('rich-text', { heading: 'Old', content: '<p>old</p>', align: 'left' });
    half.templates.home.sections.a.blocks = { 'text-1': { type: 'text', settings: { content: '<p>new</p>' } } };
    half.templates.home.sections.a.block_order = ['text-1'];
    const once = convertLegacyTextSections(half);
    const s = once.templates.home.sections.a;
    expect(s.block_order).toEqual(['heading-1', 'text-2', 'text-1']);
    expect(s.blocks['heading-1']).toEqual({ type: 'heading', settings: { text: 'Old' } });
    expect(s.blocks['text-2']).toEqual({ type: 'text', settings: { content: '<p>old</p>' } });
    expect(s.blocks['text-1'].settings.content).toBe('<p>new</p>');
    expect(s.settings).toEqual({ align: 'left' });
    expect(convertLegacyTextSections(once)).toEqual(once);
    const clean = sanitizeThemeData(once);
    expect(clean.templates.home.sections.a.block_order).toEqual(['heading-1', 'text-2', 'text-1']);
    expect(sanitizeThemeData(clean)).toEqual(clean);
  });

  it('a half-converted Image with text keeps its heading, text and button ahead of the existing blocks', () => {
    const half = legacy('image-with-text', { heading: 'H', description: '<p>D</p>', button_text: 'Go', link: '/go' });
    half.templates.home.sections.a.blocks = {
      'heading-1': { type: 'heading', settings: { text: 'Added' } },
      'button-1': { type: 'button', settings: { label: 'Added' } },
      'button-2': { type: 'button', settings: { label: 'Added too' } },
    };
    half.templates.home.sections.a.block_order = ['heading-1', 'button-1', 'button-2'];
    const s = convertLegacyTextSections(half).templates.home.sections.a;
    expect(s.block_order).toEqual(['heading-2', 'text-1', 'button-3', 'heading-1', 'button-1', 'button-2']);
    expect(s.blocks['heading-2']).toEqual({ type: 'heading', settings: { text: 'H' } });
    expect(s.blocks['text-1']).toEqual({ type: 'text', settings: { content: '<p>D</p>' } });
    expect(s.blocks['button-3']).toEqual({ type: 'button', settings: { label: 'Go', link: '/go' } });
    expect(s.blocks['heading-1'].settings.text).toBe('Added');
    expect(s.settings).toEqual({});
  });

  it('a section that already has blocks and only empty old keys just loses the keys', () => {
    const half = legacy('rich-text', { heading: '', content: '  ', align: 'center' });
    half.templates.home.sections.a.blocks = { 'text-1': { type: 'text', settings: { content: '<p>new</p>' } } };
    half.templates.home.sections.a.block_order = ['text-1'];
    const once = convertLegacyTextSections(half);
    expect(once.templates.home.sections.a.block_order).toEqual(['text-1']);
    expect(once.templates.home.sections.a.blocks).toEqual(half.templates.home.sections.a.blocks);
    expect(once.templates.home.sections.a.settings).toEqual({ align: 'center' });
    expect(convertLegacyTextSections(once)).toEqual(once);
  });

  it('is idempotent after a full conversion', () => {
    const once = convertLegacyTextSections(legacy('image-with-text', { heading: 'H', description: '<p>D</p>', button_text: 'B', link: '/b' }));
    expect(convertLegacyTextSections(once)).toEqual(once);
    expect(sanitizeThemeData(sanitizeThemeData(once))).toEqual(sanitizeThemeData(once));
  });

  it('runs inside sanitizeThemeData and the result passes the schema', () => {
    const t = sanitizeThemeData(legacy('image-with-text', { heading: 'H', description: '<p>D</p>' }));
    expect(t.templates.home.sections.a.block_order).toEqual(['heading-1', 'text-1']);
    expect(t.templates.home.sections.a.blocks['heading-1']).toEqual({ type: 'heading', settings: { text: 'H' } });
    expect(t.templates.home.sections.a.blocks['text-1']).toEqual({ type: 'text', settings: { content: '<p>D</p>' } });
    const settings = t.templates.home.sections.a.settings as Record<string, unknown>;
    for (const old of ['heading', 'description', 'button_text', 'link']) expect(settings).not.toHaveProperty(old);
  });

  it('walks the header and footer groups and custom pages too', () => {
    const raw: Raw = {
      header_group: { order: ['h'], sections: { h: { type: 'rich-text', settings: { content: '<p>top</p>' }, blocks: {}, block_order: [] } } },
      footer_group: { order: ['f'], sections: { f: { type: 'rich-text', settings: { heading: 'Foot' }, blocks: {}, block_order: [] } } },
      templates: { 'page.about': { order: ['a'], sections: { a: { type: 'rich-text', settings: { heading: 'About' }, blocks: {}, block_order: [] } } } },
    };
    const out = convertLegacyTextSections(raw);
    expect(out.header_group.sections.h.block_order).toEqual(['text-1']);
    expect(out.footer_group.sections.f.blocks['heading-1']).toEqual({ type: 'heading', settings: { text: 'Foot' } });
    expect(out.templates['page.about'].sections.a.block_order).toEqual(['heading-1']);
  });

  it('leaves other section types alone', () => {
    const raw = legacy('slideshow', { heading: 'Keep', content: 'me', button_text: 'x', link: '/y' });
    const out = convertLegacyTextSections(raw);
    expect(out.templates.home.sections.a).toEqual(raw.templates.home.sections.a);
  });

  it('does not change its input and returns a new object', () => {
    const raw = legacy('image-with-text', { heading: 'H', description: '<p>D</p>' });
    const copy = JSON.parse(JSON.stringify(raw));
    const out = convertLegacyTextSections(raw);
    expect(raw).toEqual(copy);
    expect(out).not.toBe(raw);
  });

  it('survives junk input', () => {
    for (const raw of [{}, { templates: null }, { templates: { home: 5 } }, { templates: { home: { sections: { a: null }, order: ['a'] } } }]) {
      expect(() => convertLegacyTextSections(raw as Raw)).not.toThrow();
    }
  });

  it('converts the captured pre-change Khatario preset: the tagline becomes one text block, and a second load changes nothing', () => {
    const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'presets-before', 'khatario.json'), 'utf8'));
    const once = sanitizeThemeData(before);
    const tagline = once.templates.home.sections['rich-text'];
    expect(tagline.block_order).toEqual(['text-1']);
    expect(tagline.blocks['text-1'].settings.content).toBe('<p>Fixture tagline</p>');
    expect(tagline.settings).toMatchObject({ align: 'left', spacing_top: 12, spacing_bottom: 0 });
    expect(sanitizeThemeData(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});
