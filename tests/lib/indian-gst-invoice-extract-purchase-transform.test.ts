import {
  transformExtractToPurchaseReviewFormat,
  type IndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';

function flipkartStyleExclusiveListWithInclusiveDiscount(): IndianGstInvoiceExtract {
  return {
    supplier_name: 'Tech-Connect Retail Private Limited',
    supplier_gstin: '29AAICA4872D1ZK',
    buyer_gstin: null,
    invoice_number: 'FAAAAB1901122589',
    invoice_date: '2018-05-19',
    place_of_supply: 'Maharashtra',
    tax_type: 'igst',
    price_mode: 'exclusive',
    subtotal: null,
    total_cgst: null,
    total_sgst: null,
    total_igst: 9227.3,
    round_off: null,
    grand_total: 50490,
    gst_summary: [],
    items: [
      {
        description: 'Acer Predator Helios 300',
        hsn_code: '84713010',
        qty: 1,
        unit: 'PCS',
        rate: 72025.4237,
        discount_amount: 24500,
        gst_rate: 18,
        tax_mode: null,
        taxable_value: 51262.7,
        cgst_amount: null,
        sgst_amount: null,
        igst_amount: 9227.3,
        line_total: 60490,
        discount_on_tax_inclusive: false,
      },
    ],
  };
}

describe('transformExtractToPurchaseReviewFormat', () => {
  it('infers rupee discount off tax-inclusive gross when grossInc − discount ≈ line_total (Flipkart-style)', () => {
    const out = transformExtractToPurchaseReviewFormat(
      flipkartStyleExclusiveListWithInclusiveDiscount()
    );
    expect(out.items).toHaveLength(1);
    const [line] = out.items;
    expect(line.amount).toBe(60490);
    expect(line.discount_on_tax_inclusive).toBe(true);
    expect(line.discount_amount).toBe(24500);
    expect(line.unit_price).toBeCloseTo(72025.4237, 3);
    expect(line.mapping_rule).toBe('marketplace_mrp');
    expect(line.printed_rate).toBeCloseTo(72025.4237, 3);
    expect(line.tax_mode).toBe('exclusive');
  });

  it('keeps discount off exclusive when inclusive pattern does not match', () => {
    const extraction: IndianGstInvoiceExtract = {
      ...flipkartStyleExclusiveListWithInclusiveDiscount(),
      items: [
        {
          description: 'Widget',
          hsn_code: null,
          qty: 1,
          unit: 'PCS',
          rate: 1000,
          discount_amount: 100,
          gst_rate: 18,
          tax_mode: null,
          taxable_value: null,
          cgst_amount: null,
          sgst_amount: null,
          igst_amount: null,
          line_total: 1062,
          discount_on_tax_inclusive: false,
        },
      ],
    };
    const out = transformExtractToPurchaseReviewFormat(extraction);
    expect(out.items[0].amount).toBe(1062);
    expect(out.items[0].discount_on_tax_inclusive).toBe(false);
    expect(out.items[0].unit_price).toBe(1000);
    expect(out.items[0].mapping_rule).toBe('exclusive_rate');
  });

  it('does not divide exclusive rate when printed line_total copies taxable (qty 4 × 499, GST 5%)', () => {
    const extraction: IndianGstInvoiceExtract = {
      ...flipkartStyleExclusiveListWithInclusiveDiscount(),
      price_mode: 'exclusive',
      tax_type: 'cgst_sgst',
      items: [
        {
          description: 'Widget',
          hsn_code: null,
          qty: 4,
          unit: 'PCS',
          rate: 499,
          discount_amount: null,
          gst_rate: 5,
          tax_mode: 'exclusive',
          taxable_value: 1996,
          cgst_amount: null,
          sgst_amount: null,
          igst_amount: null,
          line_total: 1996,
          discount_on_tax_inclusive: false,
        },
      ],
    };
    const [item] = transformExtractToPurchaseReviewFormat(extraction).items;
    expect(item.printed_rate).toBe(499);
    expect(item.unit_price).toBe(499);
    expect(item.tax_mode).toBe('exclusive');
    expect(item.validation_status).toBe('discrepancy');
    expect(item.discrepancy_codes).toContain('LINE_TOTAL_EQUALS_TAXABLE');
    expect(item.printed_taxable).toBe(1996);
    expect(item.printed_line_total).toBe(1996);
  });
});
