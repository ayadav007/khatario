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
  });
});
