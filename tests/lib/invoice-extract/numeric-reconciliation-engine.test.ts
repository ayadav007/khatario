import { generateNumericRepairCandidates } from '@/lib/services/invoice-extract/ocrNumericRepair';
import { normalizeIndianGstInvoiceExtract, type IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';

describe('generateNumericRepairCandidates', () => {
  it('includes 0.662 when OCR read 0.602 (0↔6 confusion)', () => {
    const c = generateNumericRepairCandidates(0.602, 'quantity');
    expect(c).toContain(0.662);
  });

  it('includes original value', () => {
    const c = generateNumericRepairCandidates(120, 'currency_rate');
    expect(c).toContain(120);
  });
});

describe('normalizeIndianGstInvoiceExtract numeric reconciliation', () => {
  it('repairs thermal qty so qty × rate matches line_total (0.602×120 → 0.662×120)', () => {
    const input: IndianGstInvoiceExtract = {
      supplier_name: 'DMart',
      supplier_gstin: null,
      buyer_gstin: null,
      invoice_number: 'T1',
      invoice_date: null,
      place_of_supply: null,
      tax_type: 'cgst_sgst',
      price_mode: 'exclusive',
      subtotal: 79.44,
      total_cgst: 0,
      total_sgst: 0,
      total_igst: null,
      round_off: null,
      grand_total: 79.44,
      gst_summary: [],
      items: [
        {
          description: 'Dal',
          hsn_code: null,
          qty: 0.602,
          unit: 'kg',
          rate: 120,
          discount_amount: null,
          gst_rate: 0,
          tax_mode: null,
          taxable_value: null,
          cgst_amount: null,
          sgst_amount: null,
          igst_amount: null,
          line_total: 79.44,
          discount_on_tax_inclusive: false,
        },
      ],
    };
    const out = normalizeIndianGstInvoiceExtract(input);
    expect(out.items[0].qty).toBeCloseTo(0.662, 3);
    expect(out.items[0].rate).toBe(120);
    expect(out.numeric_reconciliation_debug?.repairedFields?.length).toBeGreaterThanOrEqual(1);
    expect(out.numeric_reconciliation_debug?.repairedFields?.[0].field).toBe('qty');
  });

  it('does not mutate when math already matches', () => {
    const input: IndianGstInvoiceExtract = {
      supplier_name: 'X',
      supplier_gstin: null,
      buyer_gstin: null,
      invoice_number: 'T2',
      invoice_date: null,
      place_of_supply: null,
      tax_type: 'cgst_sgst',
      price_mode: 'exclusive',
      subtotal: 79.44,
      total_cgst: 0,
      total_sgst: 0,
      total_igst: null,
      round_off: null,
      grand_total: 79.44,
      gst_summary: [],
      items: [
        {
          description: 'Dal',
          hsn_code: null,
          qty: 0.662,
          unit: 'kg',
          rate: 120,
          discount_amount: null,
          gst_rate: 0,
          tax_mode: null,
          taxable_value: null,
          cgst_amount: null,
          sgst_amount: null,
          igst_amount: null,
          line_total: 79.44,
          discount_on_tax_inclusive: false,
        },
      ],
    };
    const out = normalizeIndianGstInvoiceExtract(input);
    expect(out.items[0].qty).toBeCloseTo(0.662, 3);
    expect(out.numeric_reconciliation_debug?.repairedFields?.length ?? 0).toBe(0);
    expect(
      out.numeric_reconciliation_debug?.reconciliationScores?.every((s) => s.status === 'ok')
    ).toBe(true);
  });
});
