import { getSectionSchema, sectionsForTemplate } from '@/lib/store/engine/registry';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import { pickSlidesForDevice } from '@/lib/store/engine/shared';
import { categoryImageMap, categoryMarks, engineCategoryStyle } from '@/lib/store/engine/render-helpers';
import { slideshowDevices } from '@/lib/store/engine/studio-adapter';
import type { Section } from '@/lib/store/engine/types';

type RawBlock = { type: string; settings: Record<string, unknown> };

function homeWith(type: string, settings: Record<string, unknown>, blockList: RawBlock[] = [], kind = 'home') {
  const blocks: Record<string, RawBlock> = {};
  const order: string[] = [];
  blockList.forEach((b, i) => {
    blocks[`b${i}`] = b;
    order.push(`b${i}`);
  });
  const section = { type, settings, blocks, block_order: order };
  if (kind === 'header') {
    return sanitizeThemeData({ header_group: { order: ['s'], sections: { s: section } } }).header_group.sections.s;
  }
  return sanitizeThemeData({ templates: { home: { order: ['s'], sections: { s: section } } } }).templates.home.sections.s;
}

const NEW_TYPES = ['promo-cards', 'category-shelves'];
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('M4 new sections', () => {
  it('are registered for home and page, not product', () => {
    for (const t of NEW_TYPES) {
      expect(getSectionSchema(t)).not.toBeNull();
      expect(getSectionSchema(t)!.templates).toEqual(['home', 'page']);
    }
    expect(getSectionSchema('promo-cards')!.category).toBe('Banners');
    expect(getSectionSchema('category-shelves')!.category).toBe('Products');
    const home = sectionsForTemplate('home').map((s) => s.type);
    const product = sectionsForTemplate('product').map((s) => s.type);
    for (const t of NEW_TYPES) {
      expect(home).toContain(t);
      expect(product).not.toContain(t);
    }
  });

  it('round-trip their preset through sanitizeThemeData', () => {
    for (const t of NEW_TYPES) {
      const preset = getSectionSchema(t)!.presets[0];
      const kept = homeWith(
        t,
        preset.settings ?? {},
        (preset.blocks ?? []).map((b) => ({ type: b.type, settings: b.settings ?? {} })),
      );
      expect(kept?.type).toBe(t);
      expect(kept.settings).toEqual(preset.settings ?? {});
      expect(kept.block_order).toHaveLength((preset.blocks ?? []).length);
    }
    expect(getSectionSchema('promo-cards')!.presets[0].blocks).toHaveLength(2);
  });

  it('promo-cards keeps at most four cards and has the listed defaults', () => {
    const cards = Array.from({ length: 5 }, (_, i) => ({ type: 'card', settings: { heading: `Card ${i}` } }));
    expect(homeWith('promo-cards', {}, cards).block_order).toHaveLength(4);
    const schema = getSectionSchema('promo-cards')!;
    expect(schema.settings.find((s) => s.id === 'style')).toMatchObject({ type: 'select', default: 'split' });
    expect(schema.settings.find((s) => s.id === 'columns')).toMatchObject({ type: 'range', min: 1, max: 3, default: 2 });
    const card = schema.blocks!.find((b) => b.type === 'card')!;
    expect(card.settings.find((s) => s.id === 'button_text')?.default).toBe('Shop now');
    expect(card.settings.find((s) => s.id === 'link')?.default).toBe('#catalog');
  });

  it('category-shelves clamps max_categories to 12', () => {
    expect(homeWith('category-shelves', { max_categories: 40 }).settings.max_categories).toBe(12);
  });
});

describe('M4 section extensions', () => {
  it('category-grid keeps the emoji style and drops an unknown one', () => {
    expect(homeWith('category-grid', { style: 'emoji' }).settings.style).toBe('emoji');
    expect(homeWith('category-grid', { style: 'nope' }).settings.style).toBeUndefined();
  });

  it('category-grid keeps at most 40 category images', () => {
    const blocks = Array.from({ length: 41 }, (_, i) => ({
      type: 'category_image',
      settings: { category: UUID(i + 1), image: 'https://cdn.example.com/a.jpg' },
    }));
    expect(homeWith('category-grid', {}, blocks).block_order).toHaveLength(40);
  });

  it('keeps announcement.scrolling and header.show_category_chips', () => {
    expect(homeWith('announcement', { scrolling: true }, [], 'header').settings.scrolling).toBe(true);
    expect(homeWith('header', { show_category_chips: true }, [], 'header').settings.show_category_chips).toBe(true);
  });

  it('sanitises an unknown slide device to both', () => {
    const kept = homeWith('slideshow', {}, [{ type: 'slide', settings: { heading: 'Hi', device: 'tv' } }]);
    expect(kept.blocks.b0.settings.device).toBeUndefined();
    expect(slideshowDevices(kept)).toEqual(['both']);
    const ok = homeWith('slideshow', {}, [
      { type: 'slide', settings: { device: 'mobile' } },
      { type: 'slide', settings: { device: 'desktop' } },
    ]);
    expect(slideshowDevices(ok)).toEqual(['mobile', 'desktop']);
  });
});

describe('pickSlidesForDevice', () => {
  it('returns the matching slides, else all', () => {
    expect(pickSlidesForDevice(['mobile', 'desktop', 'both'], true)).toEqual([0, 2]);
    expect(pickSlidesForDevice(['mobile', 'desktop', 'both'], false)).toEqual([1, 2]);
    expect(pickSlidesForDevice(['mobile'], false)).toEqual([0]);
    expect(pickSlidesForDevice([], true)).toEqual([]);
  });
});

describe('category tiles', () => {
  const cats = [
    { id: UUID(1), name: 'Fresh Vegetables', item_count: 3, image_url: 'https://cdn.example.com/veg.jpg' },
    { id: UUID(2), name: 'Dairy', item_count: 2, image_url: null },
  ];
  function grid(blocks: RawBlock[]): Section {
    const out: Section = { type: 'category-grid', settings: {}, blocks: {}, block_order: [] };
    blocks.forEach((b, i) => {
      out.blocks[`b${i}`] = b;
      out.block_order.push(`b${i}`);
    });
    return out;
  }

  it('categoryImageMap prefers a block image and ignores unknown categories', () => {
    const map = categoryImageMap(
      grid([
        { type: 'category_image', settings: { category: UUID(1), image: 'https://cdn.example.com/block.jpg' } },
        { type: 'category_image', settings: { category: UUID(9), image: 'https://cdn.example.com/x.jpg' } },
      ]),
      cats,
    );
    expect(map).toEqual({ [UUID(1)]: 'https://cdn.example.com/block.jpg' });
    expect(categoryImageMap(grid([]), cats)).toEqual({ [UUID(1)]: 'https://cdn.example.com/veg.jpg' });
  });

  it('categoryMarks gives emoji only for the emoji style', () => {
    const marks = categoryMarks([{ id: 'a', name: 'Fresh Vegetables' }], 'emoji');
    expect(marks.a).toBe('🥬');
    expect(categoryMarks([{ id: 'a', name: 'Fresh Vegetables' }], 'tiles')).toEqual({});
  });

  it('maps the emoji style to icon tiles', () => {
    expect(engineCategoryStyle('emoji', false)).toBe('icon');
    expect(engineCategoryStyle('emoji', true)).toBe('photo');
  });
});
