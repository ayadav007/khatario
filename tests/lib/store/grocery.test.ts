import { groceryCategoryEmoji, marqueeItems } from '@/lib/store/grocery';
import { applyStorePreset, isGroceryPack, isStudioPack, sanitizeStoreTheme, sectionEnabled, storeCanvas } from '@/lib/store/store-theme';
import { filterDemoCatalog, themeDemoStore } from '@/lib/store/theme-demo';

describe('groceryCategoryEmoji', () => {
  it('maps common grocery categories', () => {
    expect(groceryCategoryEmoji('Fresh Vegetables')).toBe('🥬');
    expect(groceryCategoryEmoji('Dairy & Eggs')).toBe('🥚');
    expect(groceryCategoryEmoji('Milk Products')).toBe('🥛');
    expect(groceryCategoryEmoji('Atta, Rice & Dal')).toBe('🌾');
    expect(groceryCategoryEmoji('Cold Drinks')).toBe('🥤');
  });

  it('falls back to a cart', () => {
    expect(groceryCategoryEmoji('Misc')).toBe('🛒');
  });
});

describe('marqueeItems', () => {
  it('splits on separators', () => {
    expect(marqueeItems('Free delivery · Fresh daily | Best prices')).toEqual(['Free delivery', 'Fresh daily', 'Best prices']);
  });

  it('handles empty text', () => {
    expect(marqueeItems('   ')).toEqual([]);
  });
});

describe('Premium Grocery pack', () => {
  it('applies the grocery preset', () => {
    const theme = sanitizeStoreTheme(applyStorePreset('grocery'));
    expect(theme.pack).toBe('grocery');
    expect(theme.accent).toBe('#176b45');
    expect(isGroceryPack(theme)).toBe(true);
    expect(isStudioPack(theme)).toBe(false);
    expect(storeCanvas(theme)).toBe('#f6f7f4');
    expect(sectionEnabled(theme, 'overlay')).toBe(true);
  });

  it('keeps the pack on custom preset', () => {
    const theme = sanitizeStoreTheme({ preset: 'custom', pack: 'grocery' });
    expect(theme.pack).toBe('grocery');
  });

  it('has dark canvas mode', () => {
    const theme = sanitizeStoreTheme({ ...applyStorePreset('grocery'), appearance_mode: 'dark' });
    expect(storeCanvas(theme)).toBe('#101a14');
  });

  it('serves a grocery demo store and catalog', () => {
    const store = themeDemoStore('theme-grocery');
    expect(store?.store_theme?.pack).toBe('grocery');
    const cat = filterDemoCatalog({ pack: 'grocery', page: 1, limit: 40 });
    expect(cat.items[0].id).toMatch(/^grocery-/);
    expect(cat.categories.find((c) => c.id === 'g-dairy')?.item_count).toBe(3);
  });
});
