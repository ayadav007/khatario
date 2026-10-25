import {
  normalizeIndianGstInvoiceExtract,
  transformExtractToPurchaseReviewFormat,
  type ExtractedInvoiceLine,
  type IndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';
import { mapExtractedLineToPurchaseLine } from '@/lib/purchases/map-extracted-line';
import {
  billTotalGap,
  previewPurchaseFormDocument,
  purchaseFormLinesFromScan,
  scanDocumentPriceMode,
  scanLineDisagreesWithBill,
  scanPrintedGrandTotal,
} from '@/lib/purchases/purchase-form-from-scan';

function row(description: string, qty: number, rate: number, value: number, gst: number): ExtractedInvoiceLine {
  return {
    description,
    hsn_code: null,
    qty,
    unit: null,
    rate,
    discount_amount: null,
    gst_rate: gst,
    tax_mode: 'inclusive',
    taxable_value: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
    line_total: value,
  };
}

/** DMart Siddhapura till roll, 17/10/2026: 14 items, Value column sums to 2130.08. */
function dmartRows(): ExtractedInvoiceLine[] {
  return [
    row('L KABULI CHANA', 0.486, 137.5, 66.83, 0),
    row('L MOONG DAL', 0.392, 117, 45.86, 0),
    row('L MASOOR DAL', 0.362, 88.5, 32.04, 0),
    row('L STDTURDAL', 0.468, 142, 66.46, 0),
    row('L SONA MASURI RAICH', 3.818, 73.5, 280.62, 0),
    row('L BESAN', 3.6, 88, 316.8, 0),
    row('TATA SALT-1kg', 3, 28, 84, 0),
    row('TATA KANAN DEV-500g', 1, 135, 135, 5),
    row('L GROUNDNUT', 0.588, 160.5, 94.37, 5),
    row('SUNPURE SUNFLOW-1lt', 3, 165, 495, 5),
    row('L SL SUGAR', 3.7, 53, 196.1, 5),
    row('DETTOL ANTISE-250ml', 1, 155, 155, 5),
    row('WHEEL ACTIVE PO-1kg', 1, 80, 80, 18),
    row('REFLECT DISHWA-500g', 1, 82, 82, 18),
  ];
}

function dmartBill(items: ExtractedInvoiceLine[]): IndianGstInvoiceExtract {
  return {
    supplier_name: 'DMART SIDDHAPURA',
    supplier_gstin: '29AACCA8432H1ZM',
    buyer_gstin: null,
    invoice_number: '560110008-002895',
    invoice_date: '2026-10-17',
    place_of_supply: null,
    tax_type: 'cgst_sgst',
    price_mode: 'inclusive',
    subtotal: 2054.14,
    total_cgst: 37.97,
    total_sgst: 37.97,
    total_igst: null,
    round_off: null,
    grand_total: 2130.08,
    items,
    gst_summary: [
      { gst_rate: 0, taxable_value: 892.61, cgst: 0, sgst: 0, igst: 0, total_tax: 0 },
      { gst_rate: 5, taxable_value: 1024.25, cgst: 25.61, sgst: 25.61, igst: 0, total_tax: 51.22 },
      { gst_rate: 18, taxable_value: 137.28, cgst: 12.36, sgst: 12.36, igst: 0, total_tax: 24.72 },
    ],
  };
}

function fill(items: ExtractedInvoiceLine[]) {
  const review = transformExtractToPurchaseReviewFormat(normalizeIndianGstInvoiceExtract(dmartBill(items)));
  const lines = purchaseFormLinesFromScan(review.items as unknown as Record<string, unknown>[]);
  const doc = previewPurchaseFormDocument(lines, scanDocumentPriceMode(review.invoice.price_mode), {
    supplierStateCode: '29',
    companyStateCode: '29',
  });
  const printed = scanPrintedGrandTotal(review.totals);
  const disagreeing = lines
    .filter((line, i) => scanLineDisagreesWithBill(line.printed_line_total, doc.lineComputeds[i]))
    .map((line) => line.item_name);
  return { review, lines, doc, printed, gap: billTotalGap(printed, doc.grandTotalLines), disagreeing };
}

describe('scanned bill checks', () => {
  it('a correctly read till roll matches the bill total with no warnings', () => {
    const { doc, printed, gap, disagreeing, review } = fill(dmartRows());
    expect(printed).toBe(2130.08);
    expect(doc.grandTotalLines).toBe(2130.08);
    expect(gap).toBeNull();
    expect(disagreeing).toEqual([]);
    expect(review.items.every((item) => item.validation_status === 'ok')).toBe(true);
  });

  it('flags a till-roll row whose rate was copied into the value column', () => {
    const items = dmartRows();
    items[9] = { ...items[9], line_total: 165 };
    const { review, gap, disagreeing } = fill(items);
    expect(review.items[9].validation_status).toBe('discrepancy');
    expect(review.items[9].discrepancy_codes).toContain('LINE_TOTAL_VS_COMPUTED');
    expect(disagreeing).toEqual(['SUNPURE SUNFLOW-1lt']);
    expect(gap).toBeNull();
  });

  it('flags a 0% row whose printed value disagrees with qty × rate', () => {
    const items = dmartRows();
    items[4] = { ...items[4], line_total: 260.62 };
    const { review, doc, gap, disagreeing } = fill(items);
    expect(review.items[4].discrepancy_codes).toContain('LINE_TOTAL_VS_COMPUTED');
    expect(disagreeing).toEqual(['L SONA MASURI RAICH']);
    expect(doc.grandTotalLines).toBe(2130.08);
    expect(gap).toBeNull();
  });

  it('reports the bill-total gap when a weighed qty and its value are both misread', () => {
    const items = dmartRows();
    items[10] = { ...items[10], qty: 1, line_total: 53 };
    const { gap, disagreeing } = fill(items);
    expect(disagreeing).toEqual([]);
    expect(gap).toBe(-143.1);
  });

  it('reports the gap when a row is missing', () => {
    const items = dmartRows();
    items.splice(11, 1);
    expect(fill(items).gap).toBe(-155);
  });

  it('accepts a value that is qty × rate plus GST when the price basis is unknown', () => {
    const mapped = mapExtractedLineToPurchaseLine(
      { ...row('Dal', 10, 100, 1180, 18), tax_mode: null },
      { headerPriceMode: null, priceBasis: 'unknown' },
    );
    expect(mapped.discrepancy_codes).toEqual(['PRICE_BASIS_UNKNOWN']);
  });

  it('billTotalGap ignores paise rounding and a missing bill total', () => {
    expect(billTotalGap(2130.08, 2130.6)).toBeNull();
    expect(billTotalGap(null, 1831.57)).toBeNull();
    expect(billTotalGap(2130.08, 1831.57)).toBe(-298.51);
    expect(scanPrintedGrandTotal({ printed_grand_total: null, grand_total: 2130.08 })).toBe(2130.08);
  });
});
