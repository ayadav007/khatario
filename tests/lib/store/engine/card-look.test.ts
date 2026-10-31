import { productCardLook } from '@/lib/store/engine/card-look';

describe('productCardLook', () => {
  const grocery = { pack: 'grocery' as const, phone_kit: false };

  it('off the engine a Grocery-design store keeps its Grocery card', () => {
    expect(productCardLook(null, grocery)).toEqual({ studioTile: false, quick: false, sheetsTheme: grocery });
  });

  it('a Grocery-design store on the Quick preset gets the Studio tile with Quick labels and sheets', () => {
    expect(productCardLook({ quick: true, phoneKit: false, tagline: false, swatches: false }, grocery)).toEqual({
      studioTile: true,
      quick: true,
      sheetsTheme: { pack: 'quick', phone_kit: false },
    });
  });

  it('a Quick-design store on another preset loses the Quick labels', () => {
    const look = productCardLook({ quick: false, phoneKit: true, tagline: false, swatches: false }, { pack: 'quick', phone_kit: false });
    expect(look).toEqual({ studioTile: true, quick: false, sheetsTheme: { pack: 'studio', phone_kit: true } });
  });

  it('carries tagline and swatch flags', () => {
    expect(productCardLook({ quick: false, phoneKit: false, tagline: true, swatches: false }, grocery).studioTile).toBe(true);
  });
});
