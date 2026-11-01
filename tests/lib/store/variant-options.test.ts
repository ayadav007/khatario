import {
  variantOptions,
  resolveVariant,
  nextSelection,
  swatchColor,
  type StoreVariant,
} from '@/lib/store/variant-options';

const v = (
  id: string,
  variant_name: string,
  attributes: Record<string, string> | null,
  current_stock = 5,
  selling_price: number | null = 100,
): StoreVariant => ({ id, variant_name, selling_price, current_stock, attributes });

describe('variantOptions', () => {
  it('merges color and Colour keys into one "Colour" axis', () => {
    const axes = variantOptions([
      v('1', 'Blue', { color: 'Blue' }),
      v('2', 'Red', { Colour: 'Red' }),
    ]);
    expect(axes).toHaveLength(1);
    expect(axes[0].key).toBe('colour');
    expect(axes[0].label).toBe('Colour');
    expect(axes[0].values.map((x) => x.value)).toEqual(['Blue', 'Red']);
  });

  it('falls back to an Option axis of variant names when attributes are empty', () => {
    const variants = [v('1', 'Small', {}), v('2', 'Large', {})];
    const axes = variantOptions(variants);
    expect(axes).toEqual([
      {
        key: 'option',
        label: 'Option',
        values: [
          { value: 'Small', inStock: true, swatch: null },
          { value: 'Large', inStock: true, swatch: null },
        ],
      },
    ]);
    expect(resolveVariant(variants, { option: 'Large' })?.id).toBe('2');
  });

  it('falls back to Option when attributes are null or mixed with empty ones', () => {
    const axes = variantOptions([v('1', 'Blue / L', { colour: 'Blue' }), v('2', 'Plain', null)]);
    expect(axes.map((a) => a.key)).toEqual(['option']);
  });

  it('puts colour first and size second, then other keys by first appearance', () => {
    const axes = variantOptions([
      v('1', 'a', { material: 'Cotton', size: 'M', color: 'Blue' }),
    ]);
    expect(axes.map((a) => [a.key, a.label])).toEqual([
      ['colour', 'Colour'],
      ['size', 'Size'],
      ['material', 'Material'],
    ]);
  });

  it('marks values out of stock when every variant with it has no stock', () => {
    const axes = variantOptions([
      v('1', 'Blue / S', { colour: 'Blue', size: 'S' }, 0),
      v('2', 'Blue / M', { colour: 'Blue', size: 'M' }, '3' as unknown as number),
      v('3', 'Red / S', { colour: 'Red', size: 'S' }, 0),
    ]);
    const size = axes.find((a) => a.key === 'size')!;
    expect(size.values.find((x) => x.value === 'S')!.inStock).toBe(false);
    expect(size.values.find((x) => x.value === 'M')!.inStock).toBe(true);
    const colour = axes.find((a) => a.key === 'colour')!;
    expect(colour.values.find((x) => x.value === 'Red')!.inStock).toBe(false);
    expect(colour.values.find((x) => x.value === 'Blue')!.inStock).toBe(true);
  });

  it('gives a swatch to colour values only', () => {
    const axes = variantOptions([v('1', 'x', { color: 'Maroon', size: 'XL' })]);
    expect(axes[0].values[0].swatch).toBe('#800000');
    expect(axes[1].values[0].swatch).toBeNull();
  });

  it('does not crash when a variant lacks a key others have', () => {
    const variants = [v('1', 'a', { colour: 'Blue', size: 'S' }), v('2', 'b', { colour: 'Red' })];
    const axes = variantOptions(variants);
    expect(axes.map((a) => a.key)).toEqual(['colour', 'size']);
    expect(resolveVariant(variants, { colour: 'Red', size: 'S' })).toBeNull();
    expect(resolveVariant(variants, { colour: 'Red' })?.id).toBe('2');
  });

  it('returns no axes for no variants', () => {
    expect(variantOptions([])).toEqual([]);
  });
});

describe('resolveVariant', () => {
  it('matches case-insensitively on key and trims values', () => {
    const variants = [v('1', 'a', { color: ' Blue ', size: 'L' })];
    expect(resolveVariant(variants, { colour: 'Blue', size: 'L' })?.id).toBe('1');
  });
});

describe('option fallback uniqueness and normalising', () => {
  it('keeps duplicate names reachable with their own stock', () => {
    const vs = [v('1', 'Default', {}, 0), v('2', 'Default', {}, 3)];
    const axis = variantOptions(vs)[0];
    expect(axis.values.map((x) => [x.value, x.inStock])).toEqual([
      ['Default', false],
      ['Default (2)', true],
    ]);
    expect(resolveVariant(vs, { option: 'Default' })?.id).toBe('1');
    expect(resolveVariant(vs, { option: 'Default (2)' })?.id).toBe('2');
  });

  it('keeps blank names reachable', () => {
    const vs = [v('1', '', {}), v('2', '  ', {})];
    expect(variantOptions(vs)[0].values.map((x) => x.value)).toEqual(['Option 1', 'Option 2']);
    expect(resolveVariant(vs, { option: 'Option 2' })?.id).toBe('2');
  });

  it('keeps a single blank-named variant reachable', () => {
    const vs = [v('1', '', {})];
    expect(variantOptions(vs)).toHaveLength(1);
    expect(resolveVariant(vs, { option: 'Option 1' })?.id).toBe('1');
  });

  it('returns a normalised copy with numeric price and stock', () => {
    const raw = { id: '1', variant_name: 'A', selling_price: '125.50', current_stock: '4', attributes: {} };
    const r = resolveVariant([raw], { option: 'A' })!;
    expect(r.selling_price).toBe(125.5);
    expect(r.current_stock).toBe(4);
  });

  it('prefers the in-stock variant for identical attribute combinations', () => {
    const vs = [v('1', 'a', { colour: 'Blue' }, 0), v('2', 'b', { colour: 'Blue' }, 2)];
    expect(resolveVariant(vs, { colour: 'Blue' })?.id).toBe('2');
  });

  it('ignores stale selection keys in nextSelection', () => {
    const vs = [v('1', 'a', { colour: 'Blue' }, 2)];
    expect(nextSelection(vs, { option: 'x', colour: 'Red' }, 'colour', 'Blue')).toEqual({ colour: 'Blue' });
  });
});

describe('nextSelection', () => {
  const variants = [
    v('1', 'Blue / S', { colour: 'Blue', size: 'S' }, 4),
    v('2', 'Blue / M', { colour: 'Blue', size: 'M' }, 4),
    v('3', 'Red / L', { colour: 'Red', size: 'L' }, 4),
    v('4', 'Red / M', { colour: 'Red', size: 'M' }, 0),
  ];

  it('picks an in-stock size when the colour changes and the old size is gone', () => {
    expect(nextSelection(variants, { colour: 'Blue', size: 'S' }, 'colour', 'Red')).toEqual({
      colour: 'Red',
      size: 'L',
    });
  });

  it('keeps other axes when a matching in-stock variant exists', () => {
    expect(nextSelection(variants, { colour: 'Blue', size: 'M' }, 'colour', 'Blue')).toEqual({
      colour: 'Blue',
      size: 'M',
    });
  });

  it('keeps a sold-out combination that exists', () => {
    expect(nextSelection(variants, { colour: 'Blue', size: 'M' }, 'colour', 'Red')).toEqual({
      colour: 'Red',
      size: 'M',
    });
  });

  it('keeps the first compatible value when nothing is in stock', () => {
    const none = [v('1', 'a', { colour: 'Blue', size: 'S' }, 0), v('2', 'b', { colour: 'Red', size: 'L' }, 0)];
    expect(nextSelection(none, { colour: 'Blue', size: 'S' }, 'colour', 'Red')).toEqual({
      colour: 'Red',
      size: 'L',
    });
  });

  it('works for the Option fallback', () => {
    const o = [v('1', 'Small', {}), v('2', 'Large', {})];
    expect(nextSelection(o, { option: 'Small' }, 'option', 'Large')).toEqual({ option: 'Large' });
  });
});

describe('swatchColor', () => {
  it('maps names and hex values', () => {
    expect(swatchColor('Maroon')).toBe('#800000');
    expect(swatchColor('#0af')).toBe('#0af');
    expect(swatchColor('#00AAFF')).toBe('#00AAFF');
    expect(swatchColor('  Off White ')).not.toBeNull();
    expect(swatchColor('XL')).toBeNull();
    expect(swatchColor('#12')).toBeNull();
  });
});
