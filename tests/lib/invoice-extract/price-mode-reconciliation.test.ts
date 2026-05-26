import {
  normalizeIndianGstInvoiceExtract,
  type IndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';
import { repairExtractSectionsDeterministic } from '@/lib/services/invoice-extract/repair/sectionRepairEngine';
import {
  matchesExclusivePosPattern,
  reconcilePriceModeFromEvidence,
} from '@/lib/services/invoice-extract/priceModeReconciliationEngine';

function idliCafeGeminiRaw(): IndianGstInvoiceExtract {
  return {
    supplier_name: 'THE IDILI CAFE',
    supplier_gstin: '33ADVFS4469F1ZJ',
    buyer_gstin: null,
    invoice_number: '42',
    invoice_date: '2026-05-25',
    place_of_supply: null,
    tax_type: 'cgst_sgst',
    price_mode: 'inclusive',
    subtotal: null,
    total_cgst: null,
    total_sgst: null,
    total_igst: null,
    round_off: null,
    grand_total: 18,
    gst_summary: [],
    items: [
      {
        description: 'WATER BOTLE (1LTR)',
        hsn_code: null,
        qty: 1,
        unit: 'PCS',
        rate: 17.14,
        discount_amount: null,
        gst_rate: 5,
        tax_mode: null,
        taxable_value: 17.14,
        cgst_amount: 0.43,
        sgst_amount: 0.43,
        igst_amount: null,
        line_total: 17.14,
        discount_on_tax_inclusive: false,
      },
    ],
  };
}

describe('priceModeReconciliationEngine', () => {
  it('chooses exclusive for HoneyBill-style POS when printed tax + grand > line sum', () => {
    const raw = idliCafeGeminiRaw();
    expect(matchesExclusivePosPattern(raw)).toBe(true);
    const recon = reconcilePriceModeFromEvidence(raw);
    expect(recon.priceMode).toBe('exclusive');
    expect(recon.exclusiveScore).toBeGreaterThan(recon.inclusiveScore);
  });

  it('normalizes Idli Café receipt to taxable 17.14, tax 0.86, grand 18', () => {
    let data = idliCafeGeminiRaw();
    const repaired = repairExtractSectionsDeterministic(data);
    data = repaired.patched;
    data = normalizeIndianGstInvoiceExtract(data);

    expect(data.price_mode).toBe('exclusive');
    expect(data.subtotal).toBeCloseTo(17.14, 2);
    expect(data.total_cgst).toBeCloseTo(0.43, 2);
    expect(data.total_sgst).toBeCloseTo(0.43, 2);
    expect(data.grand_total).toBeCloseTo(18, 2);
    expect(data.items[0]!.taxable_value).toBeCloseTo(17.14, 2);
    expect(data.items[0]!.line_total).toBeCloseTo(18, 2);

    const tax = (data.total_cgst ?? 0) + (data.total_sgst ?? 0) + (data.total_igst ?? 0);
    expect(data.subtotal! + tax).toBeCloseTo(18, 2);

    expect(repaired.notes.some((n) => n.includes('corrected line_total to implied inclusive'))).toBe(
      false,
    );
  });
});
