import {
  buildGstSlabSummary,
  calculatePurchaseLine,
  computePurchaseDocument,
  deriveExclusiveUnitPriceFromInvoiceAnchor,
} from '@/lib/purchase-gst-calculator';

describe('calculatePurchaseLine anchorInclusiveLineTotal', () => {
  it('backs out 5% GST from inclusive anchor (GROUNDNUT-style)', () => {
    const c = calculatePurchaseLine(
      {
        quantity: 0.944,
        unitPrice: 120.0106,
        discountPercent: 0,
        discountAmount: 0,
        gstRate: 5,
        taxMode: 'exclusive',
        anchorInclusiveLineTotal: 113.29,
      },
      true
    );
    expect(c.lineTotal).toBe(113.29);
    expect(c.taxableValue).toBeCloseTo(107.89, 1);
    expect(c.taxAmount + c.taxableValue).toBeCloseTo(113.29, 2);
  });

  it('prefers manual CGST/SGST over anchor', () => {
    const c = calculatePurchaseLine(
      {
        quantity: 1,
        unitPrice: 100,
        discountPercent: 0,
        discountAmount: 0,
        gstRate: 5,
        taxMode: 'exclusive',
        anchorInclusiveLineTotal: 105,
        manualCgst: 2,
        manualSgst: 2.5,
      },
      true
    );
    expect(c.cgstAmount).toBe(2);
    expect(c.sgstAmount).toBe(2.5);
  });
});

describe('deriveExclusiveUnitPriceFromInvoiceAnchor', () => {
  it('derives exclusive unit rate from inclusive line (5% GST, qty 1)', () => {
    const up = deriveExclusiveUnitPriceFromInvoiceAnchor({
      anchorInclusiveLineTotal: 250,
      quantity: 1,
      discountAmount: 0,
      discountPercent: 0,
      discountOnTaxInclusive: false,
      gstRate: 5,
    });
    expect(up).toBeCloseTo(238.1, 2);
    const c = calculatePurchaseLine(
      {
        quantity: 1,
        unitPrice: up,
        discountPercent: 0,
        discountAmount: 0,
        gstRate: 5,
        taxMode: 'exclusive',
        anchorInclusiveLineTotal: 250,
      },
      true
    );
    expect(c.lineTotal).toBe(250);
  });

  it('derives exclusive unit rate with rupee discount when GST is 0', () => {
    const up = deriveExclusiveUnitPriceFromInvoiceAnchor({
      anchorInclusiveLineTotal: 190,
      quantity: 2,
      discountAmount: 10,
      discountPercent: 0,
      discountOnTaxInclusive: false,
      gstRate: 0,
    });
    expect(up).toBe(100);
  });
});

describe('buildGstSlabSummary rebalanceIntraStateHalves', () => {
  it('makes CGST and SGST equal for each slab after summing lines', () => {
    const lines = [
      {
        quantity: 1,
        unitPrice: 0,
        discountPercent: 0,
        discountAmount: 0,
        gstRate: 5,
        taxMode: 'exclusive' as const,
        taxableValue: 100,
        taxAmount: 5,
        cgstAmount: 2.5,
        sgstAmount: 2.5,
        igstAmount: 0,
        lineTotal: 105,
      },
      {
        quantity: 1,
        unitPrice: 0,
        discountPercent: 0,
        discountAmount: 0,
        gstRate: 5,
        taxMode: 'exclusive' as const,
        taxableValue: 100,
        taxAmount: 5,
        cgstAmount: 2.51,
        sgstAmount: 2.49,
        igstAmount: 0,
        lineTotal: 105,
      },
    ];
    const rows = buildGstSlabSummary(lines as any, { rebalanceIntraStateHalves: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].cgst).toBe(rows[0].sgst);
    expect(rows[0].cgst + rows[0].sgst).toBeCloseTo(rows[0].total_tax, 5);
  });
});

describe('computePurchaseDocument with invoice_inclusive_line_total', () => {
  it('slab taxable sums match inclusive anchors by rate', () => {
    const doc = computePurchaseDocument(
      [
        {
          quantity: 1,
          unit_price: 999,
          discount_percent: 0,
          tax_rate: 0,
          invoice_inclusive_line_total: 220.5,
        },
        {
          quantity: 1,
          unit_price: 999,
          discount_percent: 0,
          tax_rate: 5,
          invoice_inclusive_line_total: 105,
        },
      ],
      {
        supplierStateCode: '27',
        companyStateCode: '27',
        headerPriceMode: 'exclusive',
      }
    );
    const byRate = new Map(doc.slabSummary.map((r) => [r.gst_rate, r]));
    expect(byRate.get(0)?.taxable_value).toBe(220.5);
    expect(byRate.get(5)?.taxable_value).toBe(100);
    expect(doc.subtotal).toBe(320.5);
  });
});
