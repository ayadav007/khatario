import { PRESET_CARD_FIELDS, productCardLook, type EngineCardLook } from '@/lib/store/engine/card-look';
import { PRODUCT_CARD_DEFAULTS, resolveCardLook } from '@/lib/store/engine/product-card';

function engine(over: Partial<EngineCardLook>): EngineCardLook {
  return {
    quick: false,
    phoneKit: false,
    tagline: false,
    swatches: false,
    storeCard: PRODUCT_CARD_DEFAULTS,
    card: resolveCardLook(PRODUCT_CARD_DEFAULTS, undefined, {}),
    schemes: [],
    ...over,
  };
}

describe('productCardLook', () => {
  const grocery = { pack: 'grocery' as const, phone_kit: false };

  it('off the engine a Grocery-design store keeps its Grocery card', () => {
    expect(productCardLook(null, grocery)).toEqual({ studioTile: false, quick: false, sheetsTheme: grocery });
  });

  it('a Grocery-design store on the Quick preset gets the Studio tile with Quick labels and sheets', () => {
    expect(productCardLook(engine({ quick: true }), grocery)).toEqual({
      studioTile: true,
      quick: true,
      sheetsTheme: { pack: 'quick', phone_kit: false },
    });
  });

  it('a Quick-design store on another preset loses the Quick labels', () => {
    const look = productCardLook(engine({ phoneKit: true }), { pack: 'quick', phone_kit: false });
    expect(look).toEqual({ studioTile: true, quick: false, sheetsTheme: { pack: 'studio', phone_kit: true } });
  });

  it('carries tagline and swatch flags', () => {
    expect(productCardLook(engine({ tagline: true }), grocery).studioTile).toBe(true);
  });
});

describe('PRESET_CARD_FIELDS', () => {
  it('shows the tagline and swatches on Heritage only', () => {
    expect(PRESET_CARD_FIELDS.heritage).toEqual({ tagline: true, swatches: true });
    for (const p of ['studio', 'quick', 'grocery', 'khatario', 'blank'] as const) expect(PRESET_CARD_FIELDS[p]).toEqual({ tagline: false, swatches: false });
  });
});
