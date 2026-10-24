import {
  normalizeIndianGstInvoiceExtract,
  transformExtractToPurchaseReviewFormat,
  type ExtractedInvoiceLine,
  type IndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';
import { mapExtractedLineToPurchaseLine } from '@/lib/purchases/map-extracted-line';
import {
  classifyPrintedPriceBasis,
  isGstBandHeadingLine,
  matchesExclusivePosPattern,
  reconcilePriceModeFromEvidence,
} from '@/lib/services/invoice-extract/priceModeReconciliationEngine';
import { repairExtractSectionsDeterministic } from '@/lib/services/invoice-extract/repair/sectionRepairEngine';

function line(overrides: Partial<ExtractedInvoiceLine> = {}): ExtractedInvoiceLine {
  return {
    description: 'Item',
    hsn_code: null,
    qty: 1,
    unit: 'PCS',
    rate: null,
    discount_amount: null,
    gst_rate: null,
    tax_mode: null,
    taxable_value: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
    line_total: null,
    discount_on_tax_inclusive: false,
    ...overrides,
  };
}

function bill(
  items: ExtractedInvoiceLine[],
  extra: Partial<IndianGstInvoiceExtract> = {},
): IndianGstInvoiceExtract {
  return {
    supplier_name: 'Supplier',
    supplier_gstin: null,
    buyer_gstin: null,
    invoice_number: '1',
    invoice_date: '2026-10-12',
    place_of_supply: null,
    tax_type: 'cgst_sgst',
    price_mode: null,
    subtotal: null,
    total_cgst: null,
    total_sgst: null,
    total_igst: null,
    round_off: null,
    grand_total: null,
    gst_summary: [],
    items,
    ...extra,
  };
}

describe('printed price basis', () => {
  it('keeps ₹80 inclusive when the item column matches the payable, even though taxable + GST also matches', () => {
    const raw = bill(
      [line({ description: 'Active PO - 1KG', rate: 80, gst_rate: 18, taxable_value: 80, line_total: 80 })],
      {
        subtotal: 67.8,
        total_cgst: 6.1,
        total_sgst: 6.1,
        grand_total: 80,
        gst_summary: [{ gst_rate: 18, taxable_value: 67.8, cgst: 6.1, sgst: 6.1, igst: 0, total_tax: 12.2 }],
      },
    );
    expect(matchesExclusivePosPattern(raw)).toBe(false);
    expect(classifyPrintedPriceBasis(raw)).toBe('inclusive');
    expect(reconcilePriceModeFromEvidence(raw).priceMode).toBe('inclusive');

    const out = transformExtractToPurchaseReviewFormat(normalizeIndianGstInvoiceExtract(raw));
    expect(out.invoice.price_mode).toBe('inclusive');
    expect(out.items).toHaveLength(1);
    expect(out.items[0].unit_price).toBe(80);
    expect(out.items[0].amount).toBe(80);
    expect(out.items[0].tax_mode).toBe('inclusive');
    expect(out.items[0].mapping_rule).toBe('document_inclusive');
    expect(out.items[0].printed_rate).toBe(80);
    expect(out.items[0].printed_line_total).toBe(80);
  });

  it('grosses the exclusive ₹80 twin when the item column is the taxable value', () => {
    const raw = bill(
      [line({ description: 'Active PO - 1KG', rate: 80, gst_rate: 18, taxable_value: 80, line_total: 80 })],
      {
        subtotal: 80,
        total_cgst: 7.2,
        total_sgst: 7.2,
        grand_total: 94.4,
      },
    );
    expect(classifyPrintedPriceBasis(raw)).toBe('exclusive');
    const out = transformExtractToPurchaseReviewFormat(normalizeIndianGstInvoiceExtract(raw));
    expect(out.invoice.price_mode).toBe('exclusive');
    expect(out.items[0].unit_price).toBe(80);
    expect(out.items[0].tax_mode).toBe('exclusive');
    expect(out.items[0].amount).toBeCloseTo(94.4, 2);
    expect(out.items[0].printed_line_total).toBe(80);
  });

  it('keeps ₹155 inclusive at 5% as the printed charge', () => {
    const raw = bill(
      [line({ description: 'Dettol', rate: 155, gst_rate: 5, taxable_value: 155, line_total: 155 })],
      {
        subtotal: 147.62,
        total_cgst: 3.69,
        total_sgst: 3.69,
        grand_total: 155,
        gst_summary: [{ gst_rate: 5, taxable_value: 147.62, cgst: 3.69, sgst: 3.69, igst: 0, total_tax: 7.38 }],
      },
    );
    expect(classifyPrintedPriceBasis(raw)).toBe('inclusive');
    const out = transformExtractToPurchaseReviewFormat(normalizeIndianGstInvoiceExtract(raw));
    expect(out.items[0].unit_price).toBe(155);
    expect(out.items[0].amount).toBe(155);
    expect(out.items[0].tax_mode).toBe('inclusive');
    expect(out.items[0].tax_rate).toBe(5);
    expect(out.items[0].printed_line_total).toBe(155);
  });

  it('uses GST bands, drops the slab heading, and keeps a product whose name mentions GST', () => {
    const heading = line({
      description: '3) CGST @ 9.00%, SGST @ 9.00%',
      rate: 0,
      gst_rate: 18,
      line_total: 0,
    });
    const book = line({ description: 'GST bill book', rate: 40, gst_rate: 0, line_total: 40 });
    expect(isGstBandHeadingLine(heading)).toBe(true);
    expect(isGstBandHeadingLine(book)).toBe(false);

    const raw = bill(
      [
        heading,
        line({ description: 'Active PO - 1KG', rate: 80, gst_rate: 18, taxable_value: 80, line_total: 80 }),
        line({ description: 'Reflect', rate: 82, gst_rate: 18, taxable_value: 82, line_total: 82 }),
        line({ description: 'Dettol', rate: 155, gst_rate: 5, taxable_value: 155, line_total: 155 }),
        line({ description: 'Sugar', rate: 53, gst_rate: 0, taxable_value: 53, line_total: 53 }),
        book,
      ],
      {
        subtotal: 377.9,
        total_cgst: 16.05,
        total_sgst: 16.05,
        grand_total: 410,
        gst_summary: [
          { gst_rate: 18, taxable_value: 137.28, cgst: 12.36, sgst: 12.36, igst: 0, total_tax: 24.72 },
          { gst_rate: 5, taxable_value: 147.62, cgst: 3.69, sgst: 3.69, igst: 0, total_tax: 7.38 },
          { gst_rate: 0, taxable_value: 93, cgst: 0, sgst: 0, igst: 0, total_tax: 0 },
        ],
      },
    );
    expect(classifyPrintedPriceBasis(raw)).toBe('inclusive');
    const repaired = repairExtractSectionsDeterministic(raw);
    expect(repaired.patched.items.map((it) => it.description)).toEqual([
      'Active PO - 1KG',
      'Reflect',
      'Dettol',
      'Sugar',
      'GST bill book',
    ]);
    expect(repaired.patched.price_mode).toBe('inclusive');
    const out = transformExtractToPurchaseReviewFormat(normalizeIndianGstInvoiceExtract(repaired.patched));
    expect(out.items.map((it) => it.item_name)).not.toContain('3) CGST @ 9.00%, SGST @ 9.00%');
    expect(out.items.find((it) => it.item_name === 'Active PO - 1KG')?.amount).toBe(80);
    expect(out.items.find((it) => it.item_name === 'Reflect')?.amount).toBe(82);
    expect(out.items.find((it) => it.item_name === 'Dettol')?.amount).toBe(155);
    expect(out.items.find((it) => it.item_name === 'GST bill book')?.amount).toBe(40);
  });

  it('classifies several exclusive bands from the taxable column', () => {
    const raw = bill(
      [
        line({ description: 'Soap', rate: 80, gst_rate: 18, taxable_value: 80, line_total: 80 }),
        line({ description: 'Oil', rate: 100, gst_rate: 5, taxable_value: 100, line_total: 100 }),
      ],
      {
        subtotal: 180,
        total_cgst: 9.7,
        total_sgst: 9.7,
        grand_total: 199.4,
        gst_summary: [
          { gst_rate: 18, taxable_value: 80, cgst: 7.2, sgst: 7.2, igst: 0, total_tax: 14.4 },
          { gst_rate: 5, taxable_value: 100, cgst: 2.5, sgst: 2.5, igst: 0, total_tax: 5 },
        ],
      },
    );
    expect(classifyPrintedPriceBasis(raw)).toBe('exclusive');
    const out = transformExtractToPurchaseReviewFormat(normalizeIndianGstInvoiceExtract(raw));
    expect(out.items[0].amount).toBeCloseTo(94.4, 2);
    expect(out.items[1].amount).toBeCloseTo(105, 2);
    expect(out.items[0].printed_line_total).toBe(80);
    expect(out.items[1].printed_line_total).toBe(100);
  });

  it('does not invent a gross-up when the payable and taxable totals are missing', () => {
    const raw = bill([
      line({ description: 'Active PO - 1KG', rate: 80, gst_rate: 18, line_total: 80 }),
    ]);
    expect(classifyPrintedPriceBasis(raw)).toBe('unknown');
    expect(reconcilePriceModeFromEvidence(raw).priceMode).toBeNull();
    const out = transformExtractToPurchaseReviewFormat(normalizeIndianGstInvoiceExtract(raw));
    expect(out.invoice.price_mode).toBeNull();
    expect(out.items[0].amount).toBe(80);
    expect(out.items[0].unit_price).toBe(80);
    expect(out.items[0].tax_mode).toBeNull();
    expect(out.items[0].mapping_rule).toBe('price_basis_unknown');
    expect(out.items[0].discrepancy_codes).toContain('PRICE_BASIS_UNKNOWN');
    expect(out.totals.printed_grand_total).toBeNull();
  });

  it('stays unknown when bands disagree and the item column matches neither footer', () => {
    const raw = bill(
      [
        line({ description: 'Active PO - 1KG', rate: 80, gst_rate: 18, taxable_value: 80, line_total: 80 }),
        line({ description: 'Oil', rate: 100, gst_rate: 5, taxable_value: 100, line_total: 100 }),
      ],
      {
        subtotal: 167.8,
        total_cgst: 8.6,
        total_sgst: 8.6,
        grand_total: 185,
        gst_summary: [
          { gst_rate: 18, taxable_value: 67.8, cgst: 6.1, sgst: 6.1, igst: 0, total_tax: 12.2 },
          { gst_rate: 5, taxable_value: 100, cgst: 2.5, sgst: 2.5, igst: 0, total_tax: 5 },
        ],
      },
    );
    expect(classifyPrintedPriceBasis(raw)).toBe('unknown');
    const out = transformExtractToPurchaseReviewFormat(raw);
    expect(out.items[0].amount).toBe(80);
    expect(out.items[0].tax_mode).toBeNull();
    expect(out.items[1].amount).toBe(100);
    expect(out.items[1].tax_mode).toBeNull();
  });

  it('still treats qty × rate = taxable = line total as exclusive when no footer is printed', () => {
    const raw = bill(
      [
        line({
          description: 'Widget',
          qty: 4,
          rate: 499,
          gst_rate: 5,
          tax_mode: 'exclusive',
          taxable_value: 1996,
          line_total: 1996,
        }),
      ],
      { price_mode: 'exclusive' },
    );
    expect(classifyPrintedPriceBasis(raw)).toBe('exclusive');
    const out = transformExtractToPurchaseReviewFormat(raw);
    expect(out.items[0].unit_price).toBe(499);
    expect(out.items[0].amount).toBeCloseTo(2095.8, 2);
    expect(out.items[0].tax_mode).toBe('exclusive');
    expect(out.items[0].printed_line_total).toBe(1996);
  });
});
