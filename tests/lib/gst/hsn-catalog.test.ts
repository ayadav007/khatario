import { searchHsnCatalog } from '@/lib/gst/hsn-catalog';
import { gstRatesForCode } from '@/lib/gst/rate-schedule';

describe('searchHsnCatalog', () => {
  it('keeps finding codes as the query grows past two letters', () => {
    const two = searchHsnCatalog('la').map((row) => row.code);
    const three = searchHsnCatalog('lap').map((row) => row.code);
    expect(two.length).toBeGreaterThan(0);
    expect(three).toContain('847130');
  });

  it('finds gears as goods with an 18 percent rate', () => {
    const gear = searchHsnCatalog('gear').find((row) => row.code === '848340');
    expect(gear?.isService).toBe(false);
    expect(gstRatesForCode('848340').map((rate) => rate.gst_rate)).toEqual([18]);
  });
});
