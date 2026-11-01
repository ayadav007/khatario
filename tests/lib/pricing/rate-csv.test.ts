import { csvToRateRows, parseCsv, toCsv } from '@/lib/pricing/rate-csv';

const items = [
  { id: 'i1', name: 'Soap Bar', code: 'SB-1' },
  { id: 'i2', name: 'Shirt', code: null },
];
const variants = [{ id: 'v1', item_id: 'i2', variant_name: 'Red / L' }];

describe('parseCsv / toCsv', () => {
  it('round-trips quotes, commas and line breaks', () => {
    const rows = [
      ['item_name', 'price'],
      ['Soap, "big"', '10'],
      ['Line\nbreak', ''],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('ignores a byte-order mark and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n\r\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('csvToRateRows', () => {
  it('matches items by code then name, and variants by name', () => {
    const table = parseCsv(
      'Item Code,Item Name,Variant,Price,Discount Percent,Min Qty,Valid From,Valid To\n' +
        'sb-1,,,"₹1,050.5",,10,2026-11-01,2026-11-30\n' +
        ',shirt,red / l,,5,,,\n'
    );
    expect(csvToRateRows(table, items, variants, { withMinQty: true })).toEqual({
      errors: [],
      rows: [
        { item_id: 'i1', variant_id: null, min_qty: 10, price: 1050.5, discount_percent: null, valid_from: '2026-11-01', valid_to: '2026-11-30' },
        { item_id: 'i2', variant_id: 'v1', min_qty: 0, price: null, discount_percent: 5, valid_from: null, valid_to: null },
      ],
    });
  });

  it('reports every bad line and keeps the good ones', () => {
    const table = parseCsv(
      'item_name,variant,price,discount_percent,valid_from,valid_to\n' +
        'Nope,,1,,,\n' +
        'Shirt,Blue,1,,,\n' +
        'Soap Bar,,abc,,,\n' +
        'Soap Bar,,,120,,\n' +
        'Soap Bar,,5,,2026-12-01,2026-11-01\n' +
        'Soap Bar,,5,,01/11/2026,\n' +
        'Soap Bar,,7,,,\n'
    );
    const out = csvToRateRows(table, items, variants, { withMinQty: false });
    expect(out.rows).toEqual([{ item_id: 'i1', variant_id: null, price: 7, discount_percent: null, valid_from: null, valid_to: null }]);
    expect(out.errors).toEqual([
      'Line 2: no item "Nope"',
      'Line 3: Shirt has no variant "Blue"',
      'Line 4: price "abc" is not valid',
      'Line 5: discount % "120" is not valid',
      'Line 6: valid_to is before valid_from',
      'Line 7: valid_from "01/11/2026" must be YYYY-MM-DD',
    ]);
  });

  it('needs an item column and a price or discount column', () => {
    expect(csvToRateRows([['price'], ['1']], items, variants, { withMinQty: false }).errors).toEqual(['Add an item_code or item_name column']);
    expect(csvToRateRows([['item_name'], ['Soap Bar']], items, variants, { withMinQty: false }).errors).toEqual([
      'Add a price or discount_percent column',
    ]);
  });
});
