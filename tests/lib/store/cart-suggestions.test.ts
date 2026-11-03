import {
  cartCategoryIds,
  cartLookupParams,
  pickSuggestions,
  suggestionsParams,
  type SuggestionCandidate,
} from '@/lib/store/cart-suggestions';

const item = (id: string, extra: Partial<SuggestionCandidate> = {}): SuggestionCandidate => ({
  id,
  current_stock: 5,
  has_variants: false,
  variants: [],
  ...extra,
});

describe('pickSuggestions', () => {
  it('leaves out products already in the cart and keeps the candidate order', () => {
    const out = pickSuggestions([item('a'), item('b'), item('c')], new Set(['b']));
    expect(out.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('leaves out products that are out of stock', () => {
    const out = pickSuggestions(
      [
        item('a', { current_stock: 0 }),
        item('b'),
        item('c', { has_variants: true, current_stock: 0, variants: [{ id: 'v1', variant_name: '1 kg', selling_price: 50, current_stock: 0, attributes: null }] }),
        item('d', { has_variants: true, current_stock: 0, variants: [{ id: 'v2', variant_name: '5 kg', selling_price: 200, current_stock: 3, attributes: null }] }),
      ],
      new Set(),
    );
    expect(out.map((i) => i.id)).toEqual(['b', 'd']);
  });

  it('caps at 4 by default, or at the limit given', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => item(id));
    expect(pickSuggestions(many, new Set()).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(pickSuggestions(many, new Set(['a']), 2).map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('shows a product once even when the list repeats it', () => {
    expect(pickSuggestions([item('a'), item('a'), item('b')], new Set()).map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('cartCategoryIds', () => {
  it('takes the categories of the cart products only, each once, in order', () => {
    const rows = [
      { id: 'a', category_id: 'c1' },
      { id: 'x', category_id: 'c9' },
      { id: 'b', category_id: 'c2' },
      { id: 'c', category_id: 'c1' },
      { id: 'd', category_id: null },
    ];
    expect(cartCategoryIds(rows, new Set(['a', 'b', 'c', 'd']))).toEqual(['c1', 'c2']);
  });
});

describe('query params', () => {
  it('looks up the cart products by id', () => {
    const p = cartLookupParams(['a', 'b'], 'br1');
    expect(p.get('ids')).toBe('a,b');
    expect(p.get('branch_id')).toBe('br1');
  });

  it('asks for in-stock products of those categories, newest first, 12 of them', () => {
    const p = suggestionsParams(['c1', 'c2'], null);
    expect(p.get('cat')).toBe('c1,c2');
    expect(p.get('stock')).toBe('1');
    expect(p.get('sort')).toBe('new');
    expect(p.get('limit')).toBe('12');
    expect(p.has('branch_id')).toBe(false);
  });
});
