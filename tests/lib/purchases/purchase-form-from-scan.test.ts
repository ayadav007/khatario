import {
  normalizeIndianGstInvoiceExtract,
  transformExtractToPurchaseReviewFormat,
  type ExtractedInvoiceLine,
  type IndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';
import {
  editPurchaseFormLine,
  previewPurchaseFormDocument,
  purchaseFormCanFinalize,
  purchaseFormLinesAfterAdd,
  purchaseFormLinesAfterRemove,
  purchaseFormLinesFromScan,
  purchaseSaveModes,
  scanDocumentPriceMode,
} from '@/lib/purchases/purchase-form-from-scan';

function line(overrides: Partial<ExtractedInvoiceLine>): ExtractedInvoiceLine {
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

function bill(items: ExtractedInvoiceLine[], extra: Partial<IndianGstInvoiceExtract> = {}): IndianGstInvoiceExtract {
  return {
    supplier_name: 'DMart',
    supplier_gstin: null,
    buyer_gstin: null,
    invoice_number: '1',
    invoice_date: '2026-10-12',
    place_of_supply: 'Gujarat',
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

function formFrom(raw: IndianGstInvoiceExtract) {
  const review = transformExtractToPurchaseReviewFormat(normalizeIndianGstInvoiceExtract(raw));
  const priceMode = scanDocumentPriceMode(review.invoice.price_mode);
  const items = purchaseFormLinesFromScan(review.items as unknown as Record<string, unknown>[]);
  const preview = previewPurchaseFormDocument(items, priceMode, {
    supplierStateCode: '24',
    companyStateCode: '24',
  });
  return { review, priceMode, items, preview };
}

describe('scan response to New Purchase form state', () => {
  it('fills inclusive Active PO, Reflect and Dettol from the review payload', () => {
    const filled = formFrom(
      bill(
        [
          line({ description: 'Active PO - 1KG', rate: 80, gst_rate: 18, taxable_value: 80, line_total: 80 }),
          line({ description: 'Reflect', rate: 82, gst_rate: 18, taxable_value: 82, line_total: 82 }),
          line({ description: 'Dettol', rate: 155, gst_rate: 5, taxable_value: 155, line_total: 155 }),
        ],
        {
          subtotal: 284.9,
          total_cgst: 16.05,
          total_sgst: 16.05,
          grand_total: 317,
          gst_summary: [
            { gst_rate: 18, taxable_value: 137.28, cgst: 12.36, sgst: 12.36, igst: 0, total_tax: 24.72 },
            { gst_rate: 5, taxable_value: 147.62, cgst: 3.69, sgst: 3.69, igst: 0, total_tax: 7.38 },
          ],
        },
      ),
    );
    expect(filled.priceMode).toBe('inclusive');
    expect(filled.items.map((item) => item.item_name)).toEqual(['Active PO - 1KG', 'Reflect', 'Dettol']);
    expect(filled.items.map((item) => item.unit_price)).toEqual([80, 82, 155]);
    expect(filled.items.map((item) => item.printed_line_total)).toEqual([80, 82, 155]);
    expect(filled.items.every((item) => item.tax_mode === 'inclusive')).toBe(true);

    const [active, reflect, dettol] = filled.preview.lineComputeds;
    expect(active.lineTotal).toBe(80);
    expect(active.taxableValue).toBeCloseTo(67.8, 2);
    expect(active.taxAmount).toBeCloseTo(12.2, 2);
    expect(reflect.lineTotal).toBe(82);
    expect(reflect.taxableValue).toBeCloseTo(69.49, 1);
    expect(reflect.taxAmount).toBeCloseTo(12.51, 1);
    expect(dettol.lineTotal).toBe(155);
    expect(dettol.taxableValue).toBeCloseTo(147.62, 2);
    expect(dettol.taxAmount).toBeCloseTo(7.38, 2);
    expect(filled.preview.priceBasisUnresolved).toBe(false);
  });

  it('adds GST on top of an exclusive printed taxable price of ₹80', () => {
    const filled = formFrom(
      bill([line({ description: 'Active PO - 1KG', rate: 80, gst_rate: 18, taxable_value: 80, line_total: 80 })], {
        subtotal: 80,
        total_cgst: 7.2,
        total_sgst: 7.2,
        grand_total: 94.4,
      }),
    );
    expect(filled.priceMode).toBe('exclusive');
    expect(filled.items[0].unit_price).toBe(80);
    expect(filled.items[0].tax_mode).toBe('exclusive');
    expect(filled.items[0].printed_line_total).toBe(80);
    expect(filled.preview.lineComputeds[0].lineTotal).toBeCloseTo(94.4, 2);
    expect(filled.preview.lineComputeds[0].taxableValue).toBeCloseTo(80, 2);
    expect(filled.preview.lineComputeds[0].taxAmount).toBeCloseTo(14.4, 2);
  });

  it('does not treat an unknown price basis as exclusive or allow finalizing it', () => {
    const filled = formFrom(
      bill([line({ description: 'Active PO - 1KG', rate: 80, gst_rate: 18, line_total: 80 })]),
    );
    expect(filled.priceMode).toBe('unknown');
    expect(filled.items[0].tax_mode).toBeUndefined();
    expect(filled.items[0].unit_price).toBe(80);
    expect(filled.items[0].printed_line_total).toBe(80);
    expect(filled.preview.priceBasisUnresolved).toBe(true);
    expect(filled.preview.lineComputeds[0].lineTotal).toBe(80);
    expect(filled.preview.lineComputeds[0].taxAmount).toBe(0);
    expect(purchaseFormCanFinalize(filled.priceMode)).toBe(false);
    expect(purchaseSaveModes(filled.priceMode, filled.items[0].tax_mode)).toEqual({
      price_mode: null,
      tax_mode: null,
    });
  });

  it('recalculates an edited inclusive line and keeps the printed amount', () => {
    const filled = formFrom(
      bill([line({ description: 'Active PO - 1KG', rate: 80, gst_rate: 18, taxable_value: 80, line_total: 80 })], {
        subtotal: 67.8,
        total_cgst: 6.1,
        total_sgst: 6.1,
        grand_total: 80,
      }),
    );
    const edited = editPurchaseFormLine(filled.items[0], 'quantity', 2);
    expect(edited.printed_line_total).toBe(80);
    expect(edited.printed_rate).toBe(80);
    expect(edited.invoice_inclusive_line_total).toBeUndefined();
    const preview = previewPurchaseFormDocument([edited], 'inclusive', {
      supplierStateCode: '24',
      companyStateCode: '24',
    });
    expect(preview.lineComputeds[0].lineTotal).toBe(160);
    expect(preview.lineComputeds[0].taxableValue).toBeCloseTo(135.59, 1);
    expect(preview.lineComputeds[0].taxAmount).toBeGreaterThan(20);
  });

  it('replaces scanned lines without duplicating them, and a catalogue add does not drop them', () => {
    const filled = formFrom(
      bill(
        [
          line({ description: 'Active PO - 1KG', rate: 80, gst_rate: 18, taxable_value: 80, line_total: 80 }),
          line({ description: 'Dettol', rate: 155, gst_rate: 5, taxable_value: 155, line_total: 155 }),
        ],
        { subtotal: 215.42, total_cgst: 9.79, total_sgst: 9.79, grand_total: 235 },
      ),
    );
    const removed = purchaseFormLinesAfterRemove(filled.items, filled.items[1].id);
    expect(removed.map((item) => item.item_name)).toEqual(['Active PO - 1KG']);
    const added = purchaseFormLinesAfterAdd(removed, {
      ...removed[0],
      id: 'manual-1',
      item_id: 'cat-1',
      item_name: 'Catalogue soap',
      unit_price: 40,
      tax_mode: 'exclusive',
      fromBillExtract: true,
      printed_rate: null,
      printed_line_total: null,
      invoice_inclusive_line_total: undefined,
    });
    expect(added.map((item) => item.item_name)).toEqual(['Active PO - 1KG', 'Catalogue soap']);
    expect(added.filter((item) => item.item_name === 'Active PO - 1KG')).toHaveLength(1);
  });
});
