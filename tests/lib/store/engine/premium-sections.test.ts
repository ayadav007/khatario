import { getSectionSchema, sectionsForTemplate } from '@/lib/store/engine/registry';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import { blockProductIds } from '@/lib/store/engine/block-products';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function blk(type: string, settings: Record<string, unknown> = {}) {
  return { type, settings };
}

/** A home template holding one section `a` with the given blocks (ids `<type>-<n>`). */
function themeWith(type: string, settings: Record<string, unknown>, blocks: Array<{ type: string; settings: Record<string, unknown> }>) {
  const byId: Record<string, { type: string; settings: Record<string, unknown> }> = {};
  const order: string[] = [];
  const counts: Record<string, number> = {};
  for (const b of blocks) {
    counts[b.type] = (counts[b.type] ?? 0) + 1;
    const id = `${b.type}-${counts[b.type]}`;
    byId[id] = b;
    order.push(id);
  }
  return {
    templates: {
      home: { order: ['a'], sections: { a: { type, settings, blocks: byId, block_order: order } } },
    },
  };
}

describe('Collage, Shop the look and Image gallery schemas', () => {
  it('registers the three sections for the right templates', () => {
    expect(getSectionSchema('collage')!.templates).toEqual(['home', 'page']);
    expect(getSectionSchema('shop-the-look')!.templates).toEqual(['home', 'page', 'product']);
    expect(getSectionSchema('image-gallery')!.templates).toEqual(['home', 'page', 'product']);
    expect(sectionsForTemplate('home').map((s) => s.type)).toEqual(
      expect.arrayContaining(['collage', 'shop-the-look', 'image-gallery']),
    );
  });

  it('names, categories and presets', () => {
    expect(getSectionSchema('collage')).toMatchObject({ name: 'Collage', category: 'Banners', max_blocks: 4 });
    expect(getSectionSchema('shop-the-look')).toMatchObject({ name: 'Shop the look', category: 'Products', max_blocks: 6 });
    expect(getSectionSchema('image-gallery')).toMatchObject({ name: 'Image gallery', category: 'Media', max_blocks: 16 });
    const collage = getSectionSchema('collage')!.presets[0];
    expect(collage.settings).toEqual({ layout: 'text-left', feature_tile: 'first' });
    expect(collage.blocks).toEqual([{ type: 'image_tile' }, { type: 'image_tile' }, { type: 'image_tile' }]);
    const look = getSectionSchema('shop-the-look')!.presets[0];
    expect(look.settings).toEqual({ show_list: true });
    expect(look.blocks ?? []).toEqual([]);
    const gallery = getSectionSchema('image-gallery')!.presets[0];
    expect(gallery.settings).toEqual({ layout: 'grid', columns: 4 });
    expect(gallery.blocks).toHaveLength(4);
    expect(gallery.blocks!.every((b) => b.type === 'image')).toBe(true);
  });

  it('collage settings and blocks', () => {
    const schema = getSectionSchema('collage')!;
    const setting = (id: string) => schema.settings.find((s) => s.id === id);
    expect(setting('layout')).toMatchObject({ type: 'select', default: 'text-left' });
    expect(setting('feature_tile')).toMatchObject({ type: 'select', default: 'first' });
    expect(setting('tile_shape')).toMatchObject({ type: 'select', default: 'portrait' });
    expect(setting('text')).toMatchObject({ type: 'richtext' });
    expect(schema.blocks!.map((b) => b.type)).toEqual(['image_tile', 'product_tile', 'category_tile']);
    expect(schema.blocks![0].settings.find((s) => s.id === 'image')).toMatchObject({ type: 'image', video: true });
  });

  it('shop-the-look and image-gallery defaults', () => {
    const look = getSectionSchema('shop-the-look')!.settings;
    expect(look.find((s) => s.id === 'show_list')).toMatchObject({ type: 'checkbox', default: true });
    expect(look.find((s) => s.id === 'show_add_all')).toMatchObject({ type: 'checkbox', default: false });
    expect(look.find((s) => s.id === 'list_heading')).toMatchObject({ default: 'In this look' });
    const gallery = getSectionSchema('image-gallery')!.settings;
    expect(gallery.find((s) => s.id === 'columns')).toMatchObject({ type: 'range', min: 2, max: 6, default: 4 });
    expect(gallery.find((s) => s.id === 'gap')).toMatchObject({ type: 'range', min: 0, max: 32, step: 4, default: 8 });
  });

  it('hotspot x/y clamp to 0–100 and default to 50', () => {
    const t = sanitizeThemeData(
      themeWith('shop-the-look', {}, [
        blk('hotspot', { product: UUID_A, x: 140, y: -3 }),
        blk('hotspot', { product: UUID_B, x: 'left' }),
      ]),
    );
    const s = t.templates.home.sections.a;
    expect(s.blocks['hotspot-1'].settings).toMatchObject({ x: 100, y: 0 });
    // A non-numeric range value is dropped; the renderer falls back to the schema default 50.
    expect(s.blocks['hotspot-2'].settings.x).toBeUndefined();
    const hotspot = getSectionSchema('shop-the-look')!.blocks![0];
    expect(hotspot.settings.find((x) => x.id === 'x')).toMatchObject({ min: 0, max: 100, step: 1, default: 50 });
    expect(hotspot.settings.find((x) => x.id === 'y')).toMatchObject({ min: 0, max: 100, step: 1, default: 50 });
  });

  it('caps blocks at 4 / 6 / 16', () => {
    const count = (type: string, blockType: string, n: number) => {
      const t = sanitizeThemeData(themeWith(type, {}, Array.from({ length: n }, () => blk(blockType))));
      return t.templates.home.sections.a.block_order.length;
    };
    expect(count('collage', 'image_tile', 5)).toBe(4);
    expect(count('shop-the-look', 'hotspot', 7)).toBe(6);
    expect(count('image-gallery', 'image', 17)).toBe(16);
  });

  it("data() asks for the blocks' products and only those", () => {
    const schema = getSectionSchema('shop-the-look')!;
    expect(
      schema.data!({}, [
        { type: 'hotspot', settings: { product: UUID_A } },
        { type: 'hotspot', settings: { product: UUID_A } },
        { type: 'hotspot', settings: {} },
      ]),
    ).toEqual({ productIds: [UUID_A] });
    expect(schema.data!({}, [])).toEqual({});
    expect(getSectionSchema('collage')!.data!({}, [{ type: 'product_tile', settings: { product: UUID_B } }])).toEqual({
      productIds: [UUID_B],
      categories: true,
      categoriesOptional: true,
    });
    expect(getSectionSchema('collage')!.data!({}, [])).toEqual({ categories: true, categoriesOptional: true });
  });
});

describe('blockProductIds', () => {
  it('keeps only UUID-looking ids of the block type, deduplicated, at most 12', () => {
    const ids = Array.from({ length: 15 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const blocks = [
      ...ids.map((id) => blk('hotspot', { product: id })),
      blk('hotspot', { product: ids[0] }),
      blk('hotspot', { product: 'not-a-uuid' }),
      blk('other', { product: UUID_A }),
    ];
    expect(blockProductIds(blocks, 'hotspot')).toEqual(ids.slice(0, 12));
    expect(blockProductIds([blk('other', { product: UUID_A })], 'hotspot')).toEqual([]);
    expect(blockProductIds([blk('tile', { pick: UUID_B })], 'tile', 'pick')).toEqual([UUID_B]);
  });
});

