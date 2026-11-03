import { buyAgainPairs, attachBuyAgainVariants } from '@/lib/store/buy-again';
import { buyAgainCards } from '@/lib/store/buy-again-cards';

const row = (item_id: string, variant_id: string | null, ordered_at: string) => ({ item_id, variant_id, ordered_at });

describe('buyAgainPairs', () => {
  it('keeps distinct item-and-pack pairs, newest first, up to the limit', () => {
    const rows = [
      row('rice', 'rice-1kg', '2026-10-01T10:00:00.000Z'),
      row('dal', null, '2026-10-20T10:00:00.000Z'),
      // The same pack ordered twice counts once, at its newest order.
      row('rice', 'rice-1kg', '2026-10-25T10:00:00.000Z'),
      // Another pack of the same product counts as its own pair.
      row('rice', 'rice-5kg', '2026-10-10T10:00:00.000Z'),
      row('oil', null, '2026-09-01T10:00:00.000Z'),
    ];
    expect(buyAgainPairs(rows, 10)).toEqual([
      { itemId: 'rice', variantId: 'rice-1kg' },
      { itemId: 'dal', variantId: null },
      { itemId: 'rice', variantId: 'rice-5kg' },
      { itemId: 'oil', variantId: null },
    ]);
    expect(buyAgainPairs(rows, 2)).toEqual([
      { itemId: 'rice', variantId: 'rice-1kg' },
      { itemId: 'dal', variantId: null },
    ]);
  });

  it('gives nothing for no rows or a zero limit', () => {
    expect(buyAgainPairs([], 5)).toEqual([]);
    expect(buyAgainPairs([row('a', null, '2026-10-01T00:00:00.000Z')], 0)).toEqual([]);
  });
});

describe('attachBuyAgainVariants', () => {
  const item = (id: string, variantIds: string[]) => ({ id, variants: variantIds.map((v) => ({ id: v })) });

  it('pairs each product with its pack, in pair order, leaving out products not found', () => {
    const items = [item('dal', []), item('rice', ['rice-1kg', 'rice-5kg'])];
    const out = attachBuyAgainVariants(
      [
        { itemId: 'rice', variantId: 'rice-5kg' },
        { itemId: 'hidden', variantId: null },
        { itemId: 'dal', variantId: null },
        { itemId: 'rice', variantId: 'rice-1kg' },
      ],
      items,
    );
    expect(out.map((x) => [x.id, x.buy_again_variant_id])).toEqual([
      ['rice', 'rice-5kg'],
      ['dal', null],
      ['rice', 'rice-1kg'],
    ]);
  });

  it('drops a pack the product no longer has but keeps the product once', () => {
    const items = [item('rice', ['rice-1kg'])];
    const out = attachBuyAgainVariants(
      [
        { itemId: 'rice', variantId: 'gone-a' },
        { itemId: 'rice', variantId: 'gone-b' },
        { itemId: 'rice', variantId: 'rice-1kg' },
      ],
      items,
    );
    expect(out.map((x) => [x.id, x.buy_again_variant_id])).toEqual([
      ['rice', null],
      ['rice', 'rice-1kg'],
    ]);
  });
});

describe('buyAgainCards', () => {
  const v = (id: string, name: string, attributes: Record<string, string> | null = null) => ({
    id,
    variant_name: name,
    selling_price: 100,
    current_stock: 5,
    attributes,
  });
  const rice = { id: 'rice', has_variants: true, selling_price: 100, variants: [v('r1', '1 kg'), v('r5', '5 kg')] };
  const dal = { id: 'dal', has_variants: false, selling_price: 90, variants: [] };
  const list = [
    { ...rice, buy_again_variant_id: 'r1' },
    { ...dal, buy_again_variant_id: null },
    { ...rice, buy_again_variant_id: 'r5' },
  ];
  const cards = (items: typeof list, packsLine: boolean) => buyAgainCards(items, packsLine).map((c) => [c.id, c.buy_again_variant_id]);

  it('keeps one card per pack when the card shows pack chips', () => {
    expect(cards(list, true)).toEqual([
      ['rice', 'r1'],
      ['dal', null],
      ['rice', 'r5'],
    ]);
  });

  it('collapses to one card per product, the newest pack, when the card shows no pack chips', () => {
    expect(cards(list, false)).toEqual([
      ['rice', 'r1'],
      ['dal', null],
    ]);
  });

  it('collapses a product with two option axes even with the packs line on', () => {
    const shirt = {
      id: 'shirt',
      has_variants: true,
      selling_price: 500,
      variants: [v('s-r', 'S Red', { size: 'S', colour: 'Red' }), v('m-b', 'M Blue', { size: 'M', colour: 'Blue' })],
    };
    expect(
      cards(
        [
          { ...shirt, buy_again_variant_id: 'm-b' },
          { ...shirt, buy_again_variant_id: 's-r' },
        ],
        true,
      ),
    ).toEqual([['shirt', 'm-b']]);
  });
});
