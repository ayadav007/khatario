import {
  allLinesPacked,
  looksLikeCourierBarcode,
  matchOrderNumber,
  matchPackScan,
} from '@/lib/store/fulfillment-scan';

const ring = {
  id: '1',
  item_name: 'Gold ring',
  quantity: 1,
  packed_qty: 0,
  code: 'GR-01',
  barcode: '8901234567890',
};

describe('fulfillment scan', () => {
  it('packs by item barcode then SKU', () => {
    expect(matchPackScan([ring], '8901234567890')?.id).toBe('1');
    expect(matchPackScan([ring], 'gr-01')?.id).toBe('1');
    expect(matchPackScan([{ ...ring, packed_qty: 1 }], '8901234567890')).toBeNull();
  });

  it('opens an order from packing-slip number or existing AWB', () => {
    const orders = [
      { id: 'a', order_number: 'STO-1042', awb: null },
      { id: 'b', order_number: 'STO-1043', awb: 'BLUED12345678' },
    ];
    expect(matchOrderNumber(orders, 'sto-1042')).toBe('a');
    expect(matchOrderNumber(orders, 'BLUED12345678')).toBe('b');
  });

  it('treats long courier codes as AWB, not SKUs', () => {
    expect(looksLikeCourierBarcode('7')).toBe(false);
    expect(looksLikeCourierBarcode('GR-01')).toBe(false);
    expect(looksLikeCourierBarcode('19012345678901')).toBe(true);
    expect(looksLikeCourierBarcode('https://track.delhivery.com/x')).toBe(true);
  });

  it('knows when a jewellery order is fully packed', () => {
    expect(allLinesPacked([ring])).toBe(false);
    expect(allLinesPacked([{ ...ring, packed_qty: 1 }])).toBe(true);
  });
});
