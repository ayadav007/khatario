import { validateProductExtras } from '@/lib/store/product-extras';

describe('validateProductExtras card fields', () => {
  it('cleans badge, tagline and swatches', () => {
    const r = validateProductExtras({
      store_badge: '  Pure Katan Silk  ',
      store_tagline: 'Varanasi • Kadwa weave',
      store_swatches: [
        { name: 'Gold', hex: '#C89D53' },
        { name: 'Bad', hex: 'red' },
        { name: 'Alpha', hex: '#aabbccdd' },
        { name: 'Short', hex: '#ABC' },
      ],
    });
    expect(r).toEqual({
      ok: true,
      value: {
        store_badge: 'Pure Katan Silk',
        store_tagline: 'Varanasi • Kadwa weave',
        store_swatches: [
          { name: 'Gold', hex: '#c89d53' },
          { name: 'Short', hex: '#abc' },
        ],
      },
    });
  });

  it('clips to the limits and nulls empty text', () => {
    const r = validateProductExtras({
      store_badge: 'x'.repeat(30),
      store_tagline: '',
      store_swatches: Array.from({ length: 7 }, (_, i) => ({ name: `s${i}`, hex: '#000' })),
    });
    expect(r.ok).toBe(false); // 7 swatches
    const ok = validateProductExtras({ store_badge: 'x'.repeat(30), store_tagline: '   ' });
    expect(ok).toEqual({ ok: true, value: { store_badge: 'x'.repeat(24), store_tagline: null } });
  });

  it('leaves absent keys out', () => {
    expect(validateProductExtras({ video_url: null })).toEqual({ ok: true, value: { video_url: null } });
  });
});
