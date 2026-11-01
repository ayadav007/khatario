import { accountCodeForStockClass, allocateByStockClass, parseStockClass } from '@/lib/inventory/stock-class';

describe('stock class accounts', () => {
  it('keeps an unknown class on Inventory', () => {
    expect(parseStockClass('nope')).toBe('trading');
    expect(accountCodeForStockClass(null)).toBe('1104');
    expect(accountCodeForStockClass('raw_material')).toBe('1160');
    expect(accountCodeForStockClass('wip')).toBe('1161');
    expect(accountCodeForStockClass('finished_goods')).toBe('1162');
  });

  it('gives one class the whole amount and splits a mix without losing paise', () => {
    expect(allocateByStockClass([{ stockClass: 'finished_goods', weight: 40 }], 40)).toEqual([
      { code: '1162', amount: 40 },
    ]);
    const split = allocateByStockClass(
      [
        { stockClass: 'raw_material', weight: 1 },
        { stockClass: 'finished_goods', weight: 1 },
      ],
      10.01,
    );
    expect(split.reduce((s, row) => s + row.amount, 0)).toBeCloseTo(10.01, 2);
    expect(split.map((row) => row.code)).toEqual(['1160', '1162']);
  });
});
