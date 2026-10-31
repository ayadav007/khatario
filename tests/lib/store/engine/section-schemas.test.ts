import { getSectionSchema, sectionsForTemplate } from '@/lib/store/engine/registry';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';

describe('main-product schema', () => {
  it('is one Product information section for the product template', () => {
    const schema = getSectionSchema('main-product');
    expect(schema).not.toBeNull();
    expect(schema!.limit).toBe(1);
    expect(schema!.templates).toEqual(['product']);
    expect(schema!.category).toBe('Product page');
    expect(sectionsForTemplate('product').map((s) => s.type)).toContain('main-product');
    expect(sectionsForTemplate('home').map((s) => s.type)).not.toContain('main-product');
  });

  it('has the section settings and block types the brief lists', () => {
    const schema = getSectionSchema('main-product')!;
    const setting = (id: string) => schema.settings.find((s) => s.id === id);
    expect(setting('gallery_position')).toMatchObject({ type: 'select', default: 'left' });
    expect(setting('thumbs')).toMatchObject({ type: 'select', default: 'side' });
    expect(setting('sticky_info')).toMatchObject({ type: 'checkbox', default: true });
    const blocks = Object.fromEntries((schema.blocks ?? []).map((b) => [b.type, b]));
    expect(Object.keys(blocks)).toEqual([
      'title',
      'price',
      'variant_picker',
      'buy_buttons',
      'description',
      'collapsible_tab',
      'delivery_estimate',
      'share',
      'custom_text',
    ]);
    for (const t of ['title', 'price', 'variant_picker', 'buy_buttons', 'description', 'delivery_estimate', 'share']) {
      expect({ t, limit: blocks[t].limit }).toEqual({ t, limit: 1 });
    }
    expect(blocks.collapsible_tab.limit).toBeUndefined();
    expect(blocks.custom_text.limit).toBeUndefined();
    expect(blocks.delivery_estimate.settings.find((s) => s.id === 'text')?.default).toBe('Delivered in 1–2 days');
    expect(blocks.collapsible_tab.settings.find((s) => s.id === 'content')?.type).toBe('richtext');
  });

  it('presets title, price, options, buy buttons and description in that order', () => {
    const preset = getSectionSchema('main-product')!.presets[0];
    expect((preset.blocks ?? []).map((b) => b.type)).toEqual(['title', 'price', 'variant_picker', 'buy_buttons', 'description']);
  });

  it('sanitizeThemeData keeps main-product in templates.product and drops it from templates.home', () => {
    const section = {
      type: 'main-product',
      settings: { gallery_position: 'right' },
      blocks: {
        t: { type: 'title', settings: {} },
        t2: { type: 'title', settings: {} },
        c: { type: 'collapsible_tab', settings: { heading: 'Care', content: '<p>Wash cold</p><script>x</script>' } },
      },
      block_order: ['t', 't2', 'c'],
    };
    const data = sanitizeThemeData({
      templates: {
        product: { order: ['mp'], sections: { mp: section } },
        home: { order: ['mp'], sections: { mp: section } },
      },
    });
    expect(data.templates.product.order).toEqual(['mp']);
    const kept = data.templates.product.sections.mp;
    expect(kept.settings.gallery_position).toBe('right');
    // `title` is limited to one block; the richtext content loses its script.
    expect(kept.block_order).toEqual(['t', 'c']);
    expect(kept.blocks.c.settings.content).toBe('<p>Wash cold</p>');
    expect(data.templates.home.order).toEqual([]);
  });
});

describe('tagline and swatch switches', () => {
  it('product sections and the title block have the tagline and swatch switches, default off', () => {
    for (const t of ['featured-products', 'product-rail']) {
      const s = getSectionSchema(t)!.settings;
      expect(s.find((x) => x.id === 'show_tagline')).toMatchObject({ type: 'checkbox', default: false });
      expect(s.find((x) => x.id === 'show_swatches')).toMatchObject({ type: 'checkbox', default: false });
    }
    const title = getSectionSchema('main-product')!.blocks!.find((b) => b.type === 'title')!;
    expect(title.settings.find((x) => x.id === 'show_tagline')).toMatchObject({ type: 'checkbox', default: false });
  });
});
