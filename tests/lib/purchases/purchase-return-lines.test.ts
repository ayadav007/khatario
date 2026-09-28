import {
  buildReturnLinesFromBill,
  buildStandaloneReturnLines,
  PurchaseReturnValidationError,
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

describe('buildStandaloneReturnLines', () => {
  it('recomputes GST from the rate and supply type', () => {
    const { totals } = buildStandaloneReturnLines({
      requested: [{ qty: 1, unit_price: 100, tax_rate: 5, tax_amount: 100 } as never],
      interState: false,
    });
    expect(totals).toMatchObject({ subtotal: 100, cgst_total: 2.5, sgst_total: 2.5, grand_total: 105 });
  });
});
