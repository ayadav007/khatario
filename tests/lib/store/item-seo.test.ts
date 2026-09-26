import {
  clipItemSeo,
  generateSeoDescriptionDraft,
  generateSeoTitleDraft,
  resolveItemSeo,
  seoTitleQuality,
} from '@/lib/store/item-seo';

describe('item SEO', () => {
  it('clips title and description', () => {
    const seo = clipItemSeo({
      seo_title: `  ${'A'.repeat(80)}  `,
      seo_description: 'Hello   world',
      seo_image_url: 'javascript:alert(1)',
    });
    expect(seo.seo_title).toHaveLength(70);
    expect(seo.seo_description).toBe('Hello world');
    expect(seo.seo_image_url).toBeNull();
  });

  it('falls back to name and description', () => {
    const resolved = resolveItemSeo({
      name: 'Water Bottle',
      description: 'Leak-proof bottle for travel.',
      image_url: 'https://cdn.example/bottle.jpg',
    });
    expect(resolved.title).toBe('Water Bottle');
    expect(resolved.description).toBe('Leak-proof bottle for travel.');
    expect(resolved.image).toBe('https://cdn.example/bottle.jpg');
  });

  it('marks a mid-length title as ok', () => {
    expect(seoTitleQuality('Premium Quality Water Bottles | Stay Hydrated')).toBe('ok');
    expect(seoTitleQuality('Hi')).toBe('short');
  });

  it('drafts a title and description from the item name', () => {
    const title = generateSeoTitleDraft({ name: 'Water Bottle', category: 'Homeware' });
    expect(title).toContain('Water Bottle');
    expect(title.length).toBeLessThanOrEqual(70);
    const desc = generateSeoDescriptionDraft({ name: 'Water Bottle', category: 'Homeware' });
    expect(desc.toLowerCase()).toContain('water bottle');
    expect(desc.length).toBeGreaterThan(40);
    expect(desc.length).toBeLessThanOrEqual(160);
  });
});
