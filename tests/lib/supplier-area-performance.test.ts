import {
  aggregateAreas,
  aggregateAreasPrivately,
  assignBands,
  statesWithEnoughShops,
  topItemPivot,
  OTHER_AREAS_LABEL,
  type AreaPerformance,
} from '@/lib/supplier-area-performance';

function row(partial: Partial<AreaPerformance> & Pick<AreaPerformance, 'label'>): AreaPerformance {
  return {
    state: partial.state || partial.label,
    city: partial.city || '',
    pincode: partial.pincode || '',
    label: partial.label,
    customerCount: partial.customerCount ?? 1,
    sellIn: partial.sellIn ?? 0,
    sellThrough: partial.sellThrough ?? 0,
    lowStockItems: partial.lowStockItems ?? 0,
    band: 'quiet',
  };
}

describe('supplier area performance', () => {
  it('rolls customers into state, city, and pin totals', () => {
    const facts = [
      { state: 'Rajasthan', city: 'Jaipur', pincode: '302001', sellIn: 1000, sellThrough: 800, lowStockItems: 1 },
      { state: 'Rajasthan', city: 'Jaipur', pincode: '302001', sellIn: 500, sellThrough: 100, lowStockItems: 0 },
      { state: 'Rajasthan', city: 'Ajmer', pincode: '305001', sellIn: 0, sellThrough: 0, lowStockItems: 2 },
    ];

    const states = aggregateAreas(facts, 'state');
    expect(states).toHaveLength(1);
    expect(states[0].customerCount).toBe(3);
    expect(states[0].sellIn).toBe(1500);
    expect(states[0].sellThrough).toBe(900);
    expect(states[0].lowStockItems).toBe(3);

    const cities = aggregateAreas(facts, 'city');
    expect(cities.map((city) => city.label)).toEqual(['Jaipur, Rajasthan', 'Ajmer, Rajasthan']);

    const pins = aggregateAreas(facts, 'pincode');
    expect(pins[0].label).toContain('302001');
    expect(pins[0].customerCount).toBe(2);
  });

  it('marks a quiet area, a strong area, and stock that is not moving onward', () => {
    const bands = assignBands([
      row({ label: 'Quiet', sellIn: 0, sellThrough: 0 }),
      row({ label: 'Stuck', sellIn: 10000, sellThrough: 500 }),
      row({ label: 'Moving', sellIn: 4000, sellThrough: 9000 }),
    ]);
    const byLabel = Object.fromEntries(bands.map((band) => [band.label, band.band]));
    expect(byLabel.Quiet).toBe('quiet');
    expect(byLabel.Stuck).toBe('watch');
    expect(byLabel.Moving).toBe('strong');
  });

  it('builds a state by item pivot for the top onward sellers', () => {
    const pivot = topItemPivot([
      { state: 'Rajasthan', itemName: 'Atta', sellThrough: 500 },
      { state: 'Gujarat', itemName: 'Atta', sellThrough: 200 },
      { state: 'Rajasthan', itemName: 'Oil', sellThrough: 50 },
      { state: 'Gujarat', itemName: 'Rice', sellThrough: 10 },
    ], 2);
    expect(pivot.items).toEqual(['Atta', 'Oil']);
    expect(pivot.matrix[0].state).toBe('Rajasthan');
    expect(pivot.matrix[0].cells.Atta).toBe(500);
    expect(pivot.matrix[0].cells.Rice).toBeUndefined();
  });

  describe('privacy floor', () => {
    const shop = (state: string, city: string, sellThrough = 100) => ({
      state, city, pincode: '', sellIn: 0, sellThrough, lowStockItems: 0,
    });

    it('shows areas with enough shops and pools the small ones', () => {
      const facts = [
        shop('Rajasthan', 'Jaipur'), shop('Rajasthan', 'Jaipur'), shop('Rajasthan', 'Jaipur'),
        shop('Gujarat', 'Surat'), shop('Gujarat', 'Rajkot'), shop('Goa', 'Panaji'),
      ];
      const { areas, hiddenShops } = aggregateAreasPrivately(facts, 'city');
      expect(areas.map((a) => a.label).sort()).toEqual(['Jaipur, Rajasthan', OTHER_AREAS_LABEL].sort());
      expect(areas.find((a) => a.label === OTHER_AREAS_LABEL)?.customerCount).toBe(3);
      expect(hiddenShops).toBe(0);
    });

    it('leaves out a pool too small to hide one shop', () => {
      const facts = [shop('Rajasthan', 'Jaipur'), shop('Rajasthan', 'Jaipur'), shop('Rajasthan', 'Jaipur'), shop('Goa', 'Panaji', 999)];
      const { areas, hiddenShops } = aggregateAreasPrivately(facts, 'state');
      expect(areas.map((a) => a.label)).toEqual(['Rajasthan']);
      expect(hiddenShops).toBe(1);
    });

    it('shows nothing for a single sharing shop', () => {
      const { areas, hiddenShops } = aggregateAreasPrivately([shop('Goa', 'Panaji')], 'state');
      expect(areas).toEqual([]);
      expect(hiddenShops).toBe(1);
      expect(statesWithEnoughShops([shop('Goa', 'Panaji')]).size).toBe(0);
    });
  });
});
