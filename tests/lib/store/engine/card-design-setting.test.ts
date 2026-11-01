import { getSectionSchema } from '@/lib/store/engine/registry';
import { defaultSettings, sanitizeSettingValue } from '@/lib/store/engine/settings';
import { CARD_DESIGN_IDS, CARD_DESIGN_LABELS } from '@/lib/store/engine/product-card';

const SECTIONS = ['featured-products', 'product-rail', 'category-shelves', 'related-products', 'recently-viewed', 'main-catalog'] as const;

describe('product sections: Card choice', () => {
  it.each(SECTIONS)('%s has a card_design select with the store choice and the ten designs, defaulting to the store', (type) => {
    const schema = getSectionSchema(type);
    const setting = schema?.settings.find((s) => s.id === 'card_design');
    expect(setting).toBeDefined();
    expect(setting?.type).toBe('select');
    expect(setting?.label).toBe('Card');
    expect(setting?.default).toBe('store');
    expect(setting?.options).toEqual([
      { value: 'store', label: "Store's card design" },
      ...CARD_DESIGN_IDS.map((id) => ({ value: id, label: CARD_DESIGN_LABELS[id] })),
    ]);
    expect(setting?.options).toHaveLength(11);
    expect(defaultSettings(schema!.settings).card_design).toBe('store');
  });

  it.each(SECTIONS)('%s keeps every Card value through the sanitiser and rejects others', (type) => {
    const setting = getSectionSchema(type)!.settings.find((s) => s.id === 'card_design')!;
    for (const value of ['store', ...CARD_DESIGN_IDS]) expect(sanitizeSettingValue(setting, value)).toBe(value);
    expect(sanitizeSettingValue(setting, 'theme')).toBeUndefined();
    expect(sanitizeSettingValue(setting, 'nope')).toBeUndefined();
    expect(sanitizeSettingValue(setting, 3)).toBeUndefined();
  });

  it.each(['featured-products', 'product-rail'] as const)('%s says its Card style applies to the theme\'s own card', (type) => {
    const style = getSectionSchema(type)!.settings.find((s) => s.id === 'card_style');
    expect(style?.info).toBe("Applies when the store uses Theme's own card");
  });
});
