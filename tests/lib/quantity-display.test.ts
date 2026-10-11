import { formatStockQuantity, normalizePack } from '@/lib/quantity-display';

describe('formatStockQuantity', () => {
  it('shows whole packs and leftover pieces', () => {
    expect(formatStockQuantity(47, 'PCS', 10, 'CTN')).toBe('4 CTN + 7 PCS');
    expect(formatStockQuantity(10, 'PCS', 10, 'CTN')).toBe('1 CTN');
    expect(formatStockQuantity(7, 'PCS', 10, 'CTN')).toBe('7 PCS');
  });

  it('does not turn a fractional quantity into a pack', () => {
    expect(formatStockQuantity(0.4756, 'KG', 10, 'CTN')).toBe('0.476 KG');
  });

  it('keeps the base unit when no pack is set', () => {
    expect(formatStockQuantity(12, 'PCS', null, null)).toBe('12 PCS');
  });
});

describe('normalizePack', () => {
  it('requires a size and a different pack name together', () => {
    expect(normalizePack({ pack_size: '', pack_unit: '' })).toEqual({ pack_size: null, pack_unit: null });
    expect(normalizePack({ pack_size: 10, pack_unit: 'ctn', unit: 'PCS' })).toEqual({
      pack_size: 10,
      pack_unit: 'CTN',
    });
    expect(normalizePack({ pack_size: 1, pack_unit: 'CTN' }).error).toMatch(/whole number/);
    expect(normalizePack({ pack_size: 10, pack_unit: 'pcs', unit: 'PCS' }).error).toMatch(/different/);
  });
});
