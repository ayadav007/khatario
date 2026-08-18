import {
  mapExtractedLineToPurchaseLine,
  maybeRestoreExclusiveUnitPriceFromLegacyExtract,
  resolvePurchaseFormLineFromExtractItem,
  type MappedPurchaseExtractLine,
} from '@/lib/purchases/map-extracted-line';
import {
  transformExtractToPurchaseReviewFormat,
  type ExtractedInvoiceLine,
  type IndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';
import { deriveUnitPriceFromInvoiceLine } from '@/lib/invoice-line-math';
import { computePurchaseDocument } from '@/lib/purchase-gst-calculator';
import { normalizeExtractionEnvelope } from '@/lib/purchases/extraction-envelope-normalize';

function line(overrides: Partial<ExtractedInvoiceLine> = {}): ExtractedInvoiceLine {
  return {
    description: 'Item',
    hsn_code: '1234',
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
    ...overrides,
  };
}

function extract(items: ExtractedInvoiceLine[], extra: Partial<IndianGstInvoiceExtract> = {}): IndianGstInvoiceExtract {
  return {
    supplier_name: 'Supplier',
    supplier_gstin: '27AAAAA0000A1Z5',
    buyer_gstin: null,
    invoice_number: 'INV-1',
    invoice_date: '2026-06-01',
    place_of_supply: 'Maharashtra',
    tax_type: 'cgst_sgst',
    price_mode: 'exclusive',
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

function map(item: ExtractedInvoiceLine, headerPriceMode: 'exclusive' | 'inclusive' = 'exclusive') {
  return mapExtractedLineToPurchaseLine(item, { headerPriceMode });
}

const PRODUCTION_BUG_LINE = line({
  description: 'Widget',
  qty: 4,
  rate: 499,
  taxable_value: 1996,
  gst_rate: 5,
  tax_mode: 'exclusive',
  line_total: 1996,
  cgst_amount: 0,
  sgst_amount: 0,
});

describe('mapExtractedLineToPurchaseLine — production bug (copied taxable as line total)', () => {
  it('keeps printed exclusive rate 499 and flags LINE_TOTAL_EQUALS_TAXABLE', () => {
    const out = map(PRODUCTION_BUG_LINE);
    expect(out.printed_rate).toBe(499);
    expect(out.printed_taxable).toBe(1996);
    expect(out.printed_line_total).toBe(1996);
    expect(out.printed_gst_rate).toBe(5);
    expect(out.printed_tax_mode).toBe('exclusive');
    expect(out.unit_price).toBe(499);
    expect(out.tax_mode).toBe('exclusive');
    expect(out.mapping_rule).toBe('exclusive_rate');
    expect(out.validation_status).toBe('discrepancy');
    expect(out.discrepancy_codes).toContain('LINE_TOTAL_EQUALS_TAXABLE');
    expect(out.amount).toBeCloseTo(2095.8, 2);
  });

  it('transformExtractToPurchaseReviewFormat exposes the same fields', () => {
    const out = transformExtractToPurchaseReviewFormat(extract([PRODUCTION_BUG_LINE]));
    const [item] = out.items;
    expect(item.printed_rate).toBe(499);
    expect(item.unit_price).toBe(499);
    expect(item.tax_mode).toBe('exclusive');
    expect(item.validation_status).toBe('discrepancy');
    expect(item.discrepancy_codes).toContain('LINE_TOTAL_EQUALS_TAXABLE');
  });

  it('does not apply deriveUnitPriceFromInvoiceLine on the mapping path (that helper still divides)', () => {
    const derived = deriveUnitPriceFromInvoiceLine(1996, 4, 0, 5, 499);
    expect(derived).toBeCloseTo(475.238095, 5);
    const mapped = map(PRODUCTION_BUG_LINE);
    expect(mapped.unit_price).not.toBeCloseTo(derived, 2);
    expect(mapped.unit_price).toBe(499);
  });

  it('purchase form fill skips the second derive when mapping_rule exists', () => {
    const mapped = map(PRODUCTION_BUG_LINE);
    const filled = resolvePurchaseFormLineFromExtractItem(mapped as unknown as Record<string, unknown>, {
      quantity: mapped.quantity,
      unitPrice: mapped.unit_price,
      taxRate: mapped.tax_rate,
      discountPercentForDerive: 0,
      amount: mapped.amount,
    });
    expect(filled.unitPrice).toBe(499);
    expect(filled.taxMode).toBe('exclusive');
    expect(filled.invoiceInclusiveLineTotal).toBeUndefined();
  });

  it('emits exclusive unit_price that computePurchaseDocument uses without GST double-count', () => {
    const mapped = map(PRODUCTION_BUG_LINE);
    const doc = computePurchaseDocument(
      [
        {
          quantity: mapped.quantity,
          unit_price: mapped.unit_price,
          discount_percent: 0,
          tax_rate: mapped.tax_rate,
          tax_mode: mapped.tax_mode,
        },
      ],
      { supplierStateCode: '27', companyStateCode: '27', headerPriceMode: 'exclusive' }
    );
    expect(doc.subtotal).toBeCloseTo(1996, 2);
    expect(doc.taxTotal).toBeCloseTo(99.8, 2);
    expect(doc.grandTotalLines).toBeCloseTo(2095.8, 2);
  });
});

describe('mapExtractedLineToPurchaseLine — GST modes', () => {
  it('exclusive GST with matching printed columns is ok', () => {
    const out = map(
      line({
        qty: 4,
        rate: 499,
        taxable_value: 1996,
        gst_rate: 5,
        tax_mode: 'exclusive',
        line_total: 2095.8,
        cgst_amount: 49.9,
        sgst_amount: 49.9,
      })
    );
    expect(out.unit_price).toBe(499);
    expect(out.tax_mode).toBe('exclusive');
    expect(out.mapping_rule).toBe('exclusive_rate');
    expect(out.validation_status).toBe('ok');
    expect(out.discrepancy_codes).toEqual([]);
    expect(out.amount).toBeCloseTo(2095.8, 2);
    expect(out.cgst_amount).toBe(49.9);
    expect(out.sgst_amount).toBe(49.9);
  });

  it('inclusive GST backs out exclusive unit_price from printed taxable', () => {
    const out = map(
      line({
        qty: 2,
        rate: 118,
        taxable_value: 200,
        gst_rate: 18,
        tax_mode: 'inclusive',
        line_total: 236,
      })
    );
    expect(out.mapping_rule).toBe('inclusive_rate');
    expect(out.unit_price).toBeCloseTo(100, 5);
    expect(out.tax_mode).toBe('exclusive');
    expect(out.printed_tax_mode).toBe('inclusive');
    expect(out.printed_rate).toBe(118);
    expect(out.validation_status).toBe('ok');
    expect(out.amount).toBe(236);
  });

  it('infers inclusive when identities hold and taxable is not qty×rate', () => {
    const out = map(
      line({
        qty: 1,
        rate: 118,
        taxable_value: 100,
        gst_rate: 18,
        tax_mode: null,
        line_total: 118,
      })
    );
    expect(out.mapping_rule).toBe('inclusive_rate');
    expect(out.unit_price).toBeCloseTo(100, 5);
    expect(out.tax_mode).toBe('exclusive');
  });

  it('does not treat exclusive identity as inclusive even if tax_mode says inclusive', () => {
    const out = map(
      line({
        qty: 4,
        rate: 499,
        taxable_value: 1996,
        gst_rate: 5,
        tax_mode: 'inclusive',
        line_total: 1996,
      })
    );
    expect(out.mapping_rule).toBe('exclusive_rate');
    expect(out.unit_price).toBe(499);
    expect(out.printed_tax_mode).toBe('inclusive');
    expect(out.discrepancy_codes).toContain('LINE_TOTAL_EQUALS_TAXABLE');
  });

  it('zero GST keeps printed rate', () => {
    const out = map(
      line({
        qty: 2,
        rate: 50,
        taxable_value: 100,
        gst_rate: 0,
        tax_mode: 'exclusive',
        line_total: 100,
      })
    );
    expect(out.mapping_rule).toBe('zero_gst');
    expect(out.unit_price).toBe(50);
    expect(out.amount).toBe(100);
    expect(out.tax_rate).toBe(0);
    expect(out.printed_rate).toBe(50);
  });

  it('IGST amounts pass through on an exclusive line', () => {
    const out = map(
      line({
        qty: 1,
        rate: 1000,
        taxable_value: 1000,
        gst_rate: 18,
        tax_mode: 'exclusive',
        line_total: 1180,
        igst_amount: 180,
        cgst_amount: 0,
        sgst_amount: 0,
      })
    );
    expect(out.unit_price).toBe(1000);
    expect(out.igst_amount).toBe(180);
    expect(out.validation_status).toBe('ok');
  });

  it('exclusive rupee discount (not marketplace) keeps list rate', () => {
    const out = map(
      line({
        qty: 1,
        rate: 1000,
        discount_amount: 100,
        gst_rate: 18,
        tax_mode: 'exclusive',
        line_total: 1062,
        discount_on_tax_inclusive: false,
      })
    );
    expect(out.mapping_rule).toBe('exclusive_rate');
    expect(out.discount_on_tax_inclusive).toBe(false);
    expect(out.unit_price).toBe(1000);
    expect(out.amount).toBe(1062);
    expect(out.discount_amount).toBe(100);
  });

  it('marketplace MRP infers discount off tax-inclusive gross and keeps printed exclusive rate', () => {
    const out = map(
      line({
        description: 'Acer Predator Helios 300',
        qty: 1,
        rate: 72025.4237,
        discount_amount: 24500,
        gst_rate: 18,
        tax_mode: null,
        taxable_value: 51262.7,
        igst_amount: 9227.3,
        line_total: 60490,
        discount_on_tax_inclusive: false,
      })
    );
    expect(out.mapping_rule).toBe('marketplace_mrp');
    expect(out.discount_on_tax_inclusive).toBe(true);
    expect(out.unit_price).toBeCloseTo(72025.4237, 3);
    expect(out.printed_rate).toBeCloseTo(72025.4237, 3);
    expect(out.amount).toBe(60490);
    expect(out.tax_mode).toBe('exclusive');
  });
});

describe('mapExtractedLineToPurchaseLine — missing fields, mixed GST, round-off', () => {
  it('missing rate uses taxable / qty and flags RATE_MISSING', () => {
    const out = map(
      line({
        qty: 4,
        rate: null,
        taxable_value: 1996,
        gst_rate: 5,
        tax_mode: 'exclusive',
        line_total: 2095.8,
      })
    );
    expect(out.mapping_rule).toBe('exclusive_from_taxable');
    expect(out.unit_price).toBe(499);
    expect(out.printed_rate).toBeNull();
    expect(out.discrepancy_codes).toContain('RATE_MISSING');
    expect(out.validation_status).toBe('incomplete');
  });

  it('missing quantity flags QTY_MISSING and does not rewrite printed rate', () => {
    const out = map(
      line({
        qty: null,
        rate: 499,
        taxable_value: 1996,
        gst_rate: 5,
        tax_mode: 'exclusive',
        line_total: 1996,
      })
    );
    expect(out.printed_rate).toBe(499);
    expect(out.unit_price).toBe(499);
    expect(out.discrepancy_codes).toContain('QTY_MISSING');
    expect(out.quantity).toBe(1);
  });

  it('mixed GST invoice maps each line independently', () => {
    const out = transformExtractToPurchaseReviewFormat(
      extract([
        line({
          description: 'Rice',
          qty: 1,
          rate: 100,
          gst_rate: 0,
          taxable_value: 100,
          line_total: 100,
        }),
        line({
          description: 'Tea',
          qty: 2,
          rate: 50,
          gst_rate: 5,
          tax_mode: 'exclusive',
          taxable_value: 100,
          line_total: 105,
          cgst_amount: 2.5,
          sgst_amount: 2.5,
        }),
        line({
          description: 'Service',
          qty: 1,
          rate: 1000,
          gst_rate: 18,
          tax_mode: 'exclusive',
          taxable_value: 1000,
          line_total: 1180,
          igst_amount: 180,
        }),
      ])
    );
    expect(out.items[0].mapping_rule).toBe('zero_gst');
    expect(out.items[0].unit_price).toBe(100);
    expect(out.items[1].unit_price).toBe(50);
    expect(out.items[1].tax_rate).toBe(5);
    expect(out.items[1].cgst_amount).toBe(2.5);
    expect(out.items[2].unit_price).toBe(1000);
    expect(out.items[2].igst_amount).toBe(180);
  });

  it('keeps printed round_off and grand_total instead of rewriting to force arithmetic balance', () => {
    const out = transformExtractToPurchaseReviewFormat(
      extract([PRODUCTION_BUG_LINE], {
        subtotal: 1996,
        round_off: -0.2,
        grand_total: 1995.8,
        total_cgst: 0,
        total_sgst: 0,
      })
    );
    expect(out.totals.round_off).toBe(-0.2);
    expect(out.totals.grand_total).toBe(1995.8);
    expect(out.totals.subtotal).toBe(1996);
    expect(out.items[0].printed_line_total).toBe(1996);
    expect(out.items[0].unit_price).toBe(499);
  });
});

describe('legacy extract restore and envelope', () => {
  it('restores exclusive unit_price when old jobs stored taxable/(1+GST)/qty', () => {
    const restored = maybeRestoreExclusiveUnitPriceFromLegacyExtract({
      quantity: 4,
      unit_price: 475.238095,
      tax_rate: 5,
      tax_mode: 'exclusive',
      taxable_value: 1996,
    });
    expect(restored).toBe(499);
  });

  it('does not restore when qty × unit_price already matches taxable', () => {
    const restored = maybeRestoreExclusiveUnitPriceFromLegacyExtract({
      quantity: 4,
      unit_price: 499,
      tax_rate: 5,
      tax_mode: 'exclusive',
      taxable_value: 1996,
    });
    expect(restored).toBe(499);
  });

  it('legacy form fill derives then restores the production-bug stored row', () => {
    const filled = resolvePurchaseFormLineFromExtractItem(
      {
        quantity: 4,
        unit_price: 475.238095,
        tax_rate: 5,
        tax_mode: 'exclusive',
        taxable_value: 1996,
        amount: 1996,
      },
      {
        quantity: 4,
        unitPrice: 475.238095,
        taxRate: 5,
        discountPercentForDerive: 0,
        amount: 1996,
      }
    );
    expect(filled.unitPrice).toBe(499);
    expect(filled.taxMode).toBe('exclusive');
  });

  it('normalizeExtractionEnvelope keeps printed_* and mapping provenance', () => {
    const mapped = map(PRODUCTION_BUG_LINE);
    const env = normalizeExtractionEnvelope({
      data: { items: [mapped], totals: { round_off: -0.2, grand_total: 1995.8 } },
    });
    const item = env.data.items[0] as MappedPurchaseExtractLine;
    expect(item.printed_rate).toBe(499);
    expect(item.printed_taxable).toBe(1996);
    expect(item.printed_line_total).toBe(1996);
    expect(item.mapping_rule).toBe('exclusive_rate');
    expect(item.validation_status).toBe('discrepancy');
    expect(item.discrepancy_codes).toContain('LINE_TOTAL_EQUALS_TAXABLE');
    expect(env.data.totals.round_off).toBe(-0.2);
  });
});
