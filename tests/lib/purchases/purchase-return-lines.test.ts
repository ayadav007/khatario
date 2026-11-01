import {
  alreadyReturnedByBillLine,
  applyIncidentalFreightRefund,
  buildReturnLinesFromBill,
  buildStandaloneReturnLines,
  formLinesFromPurchase,
  incidentalAllocationsFromCharges,
  PurchaseReturnValidationError,
  scaleLinkedReturnLine,
  type ReturnTotals,
} from '@/lib/purchases/purchase-return-lines';

const bill = [
  {
    item_id: 'almirah',
    item_name: 'Steel Almirah',
    hsn_sac: '9403',
    unit: 'PCS',
    quantity: 10,
    taxable_value: 9000, // ₹1,000 less 10% discount
    tax_rate: 18,
    igst_amount: 0,
  },
];

describe('buildReturnLinesFromBill', () => {
  it('values the return at the bill net cost and rate, ignoring client tax', () => {
    const { lines, totals } = buildReturnLinesFromBill({
      billLines: bill,
      requested: [{ item_id: 'almirah', qty: 2, unit_price: 5000, tax_rate: 0 }],
      alreadyReturned: new Map(),
    });
    expect(lines[0]).toMatchObject({ taxable_value: 1800, tax_rate: 18, cgst_amount: 162, sgst_amount: 162, igst_amount: 0 });
    expect(totals).toMatchObject({ subtotal: 1800, tax_total: 324, grand_total: 2124 });
  });

  it('uses IGST when the bill was inter-state', () => {
    const { lines } = buildReturnLinesFromBill({
      billLines: [{ ...bill[0], igst_amount: 1620 }],
      requested: [{ item_id: 'almirah', qty: 1 }],
      alreadyReturned: new Map(),
    });
    expect(lines[0]).toMatchObject({ igst_amount: 162, cgst_amount: 0, sgst_amount: 0 });
  });

  it('caps quantity at purchased minus already returned', () => {
    expect(() =>
      buildReturnLinesFromBill({
        billLines: bill,
        requested: [{ item_id: 'almirah', qty: 11 }],
        alreadyReturned: new Map(),
      })
    ).toThrow(expect.objectContaining({ code: 'RETURN_EXCEEDS_PURCHASED' }));

    expect(() =>
      buildReturnLinesFromBill({
        billLines: bill,
        requested: [{ item_id: 'almirah', qty: 3 }],
        alreadyReturned: new Map([['id:almirah', 8]]),
      })
    ).toThrow(PurchaseReturnValidationError);
  });

  it('counts split lines of the same item together', () => {
    expect(() =>
      buildReturnLinesFromBill({
        billLines: bill,
        requested: [
          { item_id: 'almirah', qty: 6 },
          { item_id: 'almirah', qty: 5 },
        ],
        alreadyReturned: new Map(),
      })
    ).toThrow(expect.objectContaining({ code: 'RETURN_EXCEEDS_PURCHASED' }));
  });

  it('rejects items not on the bill', () => {
    expect(() =>
      buildReturnLinesFromBill({
        billLines: bill,
        requested: [{ item_id: 'chair', qty: 1 }],
        alreadyReturned: new Map(),
      })
    ).toThrow(expect.objectContaining({ code: 'RETURN_ITEM_NOT_ON_BILL' }));
  });
});

describe('formLinesFromPurchase', () => {
  it('lists each purchased item by its bill name, even without a catalog match', () => {
    const lines = formLinesFromPurchase([
      {
        item_id: 'almirah',
        item_name: 'Steel Almirah',
        hsn_sac: '9403',
        quantity: 10,
        unit_price: 1000,
        discount_percent: 10,
        taxable_value: 9000,
        tax_rate: 18,
        cgst_amount: 810,
        sgst_amount: 810,
        igst_amount: 0,
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      item_name: 'Steel Almirah',
      qty: 10,
      max_qty: 10,
      unit_price: 900,
      tax_rate: 18,
    });
  });

  it('uses the catalog name when the bill line name is blank', () => {
    const lines = formLinesFromPurchase([
      { item_id: 'chair', item_name: '  ', catalog_item_name: 'Office Chair', quantity: 2, taxable_value: 200, tax_rate: 5 },
    ]);
    expect(lines[0].item_name).toBe('Office Chair');
  });

  it('defaults quantity to what is still returnable', () => {
    const lines = formLinesFromPurchase([
      { item_id: 'almirah', item_name: 'Steel Almirah', quantity: 10, taxable_value: 9000, tax_rate: 18, returned_qty: 4 },
    ]);
    expect(lines[0]).toMatchObject({ qty: 6, purchased_qty: 10, already_returned: 4, max_qty: 6 });
    expect(scaleLinkedReturnLine(lines[0], 99).qty).toBe(6);
    expect(scaleLinkedReturnLine(lines[0], 2)).toMatchObject({ qty: 2, taxable_value: 1800, unit_price: 900 });
  });
});

const freightAndService = [
  {
    classification: 'incidental_to_goods',
    taxable_value: 1000,
    cgst_amount: 90,
    sgst_amount: 90,
    igst_amount: 0,
    allocations: [{ item_id: 'cotton', amount: 1000, quantity: 10 }],
  },
  {
    classification: 'independent_service',
    taxable_value: 500,
    cgst_amount: 45,
    sgst_amount: 45,
    igst_amount: 0,
    allocations: [{ item_id: 'cotton', amount: 500, quantity: 10 }],
  },
];

function goodsTotals(qty: number, interState = false): ReturnTotals {
  const lines = formLinesFromPurchase([
    {
      item_id: 'cotton',
      item_name: 'Browser Cotton',
      quantity: 10,
      taxable_value: 10000,
      tax_rate: 18,
      igst_amount: interState ? 1800 : 0,
      cgst_amount: interState ? 0 : 900,
      sgst_amount: interState ? 0 : 900,
    },
  ]);
  const scaled = scaleLinkedReturnLine(lines[0], qty);
  return {
    subtotal: scaled.taxable_value,
    cgst_total: scaled.cgst_amount,
    sgst_total: scaled.sgst_amount,
    igst_total: scaled.igst_amount,
    tax_total: scaled.tax_amount,
    grand_total: scaled.line_total,
  };
}

describe('incidental freight refund preview', () => {
  const allocations = incidentalAllocationsFromCharges(freightAndService);

  it('leaves an independent service out of the freight refund', () => {
    expect(allocations).toHaveLength(1);
    expect(allocations[0].amount).toBe(1000);
  });

  it('keeps the goods total when freight is not refunded', () => {
    expect(goodsTotals(4)).toMatchObject({ subtotal: 4000, tax_total: 720, cgst_total: 360, sgst_total: 360, grand_total: 4720 });
  });

  it('adds the remaining freight and its GST after an earlier return', () => {
    const preview = applyIncidentalFreightRefund(goodsTotals(6), {
      allocations,
      lines: [{ item_id: 'cotton', qty: 6 }],
      priorQuantities: new Map([['cotton', [4]]]),
    });
    expect(preview).toEqual({
      subtotal: 6600,
      cgst_total: 594,
      sgst_total: 594,
      igst_total: 0,
      tax_total: 1188,
      grand_total: 7788,
    });
  });

  it('uses IGST on the freight charge when the supply was inter-state', () => {
    const preview = applyIncidentalFreightRefund(goodsTotals(6, true), {
      allocations: incidentalAllocationsFromCharges([
        {
          classification: 'incidental_to_goods',
          taxable_value: 1000,
          cgst_amount: 0,
          sgst_amount: 0,
          igst_amount: 180,
          allocations: [{ item_id: 'cotton', amount: 1000, quantity: 10 }],
        },
      ]),
      lines: [{ item_id: 'cotton', qty: 6 }],
      priorQuantities: new Map([['cotton', [4]]]),
    });
    expect(preview).toMatchObject({ subtotal: 6600, igst_total: 1188, cgst_total: 0, sgst_total: 0, tax_total: 1188, grand_total: 7788 });
  });

  it('gives the last quantity slice the remaining freight paise', () => {
    const preview = applyIncidentalFreightRefund(
      { subtotal: 0, cgst_total: 0, sgst_total: 0, igst_total: 0, tax_total: 0, grand_total: 0 },
      {
        allocations: incidentalAllocationsFromCharges([
          {
            classification: 'incidental_to_goods',
            taxable_value: 100,
            cgst_amount: 9,
            sgst_amount: 9,
            igst_amount: 0,
            allocations: [{ item_id: 'cotton', amount: 100, quantity: 3 }],
          },
        ]),
        lines: [{ item_id: 'cotton', qty: 1 }],
        priorQuantities: new Map([['cotton', [1, 1]]]),
      }
    );
    expect(preview).toEqual({
      subtotal: 33.34,
      cgst_total: 3,
      sgst_total: 3,
      igst_total: 0,
      tax_total: 6,
      grand_total: 39.34,
    });
  });
});

describe('buildStandaloneReturnLines', () => {
  it('recomputes GST from the rate and supply type', () => {
    const { totals } = buildStandaloneReturnLines({
      requested: [{ qty: 1, unit_price: 100, tax_rate: 5, tax_amount: 100 } as never],
      interState: false,
    });
    expect(totals).toMatchObject({ subtotal: 100, cgst_total: 2.5, sgst_total: 2.5, grand_total: 105 });
  });
});

describe('sizes and colours on a purchase return', () => {
  const kurti = (variant_id: string, quantity: number, taxable: number) => ({
    item_id: 'kurti',
    item_name: 'Kurti Floral',
    hsn_sac: '6204',
    unit: 'PCS',
    quantity,
    taxable_value: taxable,
    tax_rate: 5,
    igst_amount: 0,
    variant_id,
  });
  const twoSizes = [kurti('M', 10, 4000), kurti('L', 5, 2500)];

  test('each size is returned at its own cost and keeps its variant', () => {
    const { lines } = buildReturnLinesFromBill({
      billLines: twoSizes,
      requested: [{ item_id: 'kurti', variant_id: 'L', qty: 2 }],
      alreadyReturned: new Map(),
    });
    expect(lines[0]).toMatchObject({ item_id: 'kurti', variant_id: 'L', qty: 2, unit_price: 500, taxable_value: 1000 });
  });

  test('an item bought in several sizes needs the size', () => {
    expect(() =>
      buildReturnLinesFromBill({ billLines: twoSizes, requested: [{ item_id: 'kurti', qty: 1 }], alreadyReturned: new Map() })
    ).toThrow(expect.objectContaining({ code: 'RETURN_VARIANT_REQUIRED' }));
  });

  test('an item bought in one size is found without naming it', () => {
    const { lines } = buildReturnLinesFromBill({
      billLines: [kurti('M', 10, 4000)],
      requested: [{ item_id: 'kurti', qty: 1 }],
      alreadyReturned: new Map(),
    });
    expect(lines[0].variant_id).toBe('M');
  });

  test('the cap is per size, and an older return without a variant counts against the only size', () => {
    const returned = alreadyReturnedByBillLine(twoSizes, [{ item_id: 'kurti', description: 'Kurti Floral', variant_id: 'L', qty: 5 }]);
    expect(() =>
      buildReturnLinesFromBill({ billLines: twoSizes, requested: [{ item_id: 'kurti', variant_id: 'L', qty: 1 }], alreadyReturned: returned })
    ).toThrow(expect.objectContaining({ code: 'RETURN_EXCEEDS_PURCHASED' }));
    expect(
      buildReturnLinesFromBill({ billLines: twoSizes, requested: [{ item_id: 'kurti', variant_id: 'M', qty: 10 }], alreadyReturned: returned }).lines[0].qty
    ).toBe(10);

    const legacy = alreadyReturnedByBillLine([kurti('M', 10, 4000)], [{ item_id: 'kurti', description: 'Kurti Floral', variant_id: null, qty: 4 }]);
    expect(legacy.get('id:kurti:v:M')).toBe(4);
  });

  test('the return form shows one line per size with its name', () => {
    const lines = formLinesFromPurchase([
      { ...kurti('M', 10, 4000), variant_name: 'Blue / M' },
      { ...kurti('L', 5, 2500), variant_name: 'Blue / L', returned_qty: 2 },
    ]);
    expect(lines.map((l) => [l.item_name, l.variant_id, l.max_qty])).toEqual([
      ['Kurti Floral (Blue / M)', 'M', 10],
      ['Kurti Floral (Blue / L)', 'L', 3],
    ]);
  });
});
