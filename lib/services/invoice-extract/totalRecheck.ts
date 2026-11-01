import {
  transformExtractToPurchaseReviewFormat,
  type IndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';
import { round2 } from '@/lib/numeric-precision';
import {
  billTotalGap,
  previewPurchaseFormDocument,
  purchaseFormLinesFromScan,
  scanDocumentPriceMode,
  scanPrintedGrandTotal,
} from '@/lib/purchases/purchase-form-from-scan';

export interface ExtractionTotalCheck {
  /** Payable printed on the bill. */
  printed: number;
  /** What the read lines (plus round off) come to on the purchase form. */
  linesTotal: number;
  /** linesTotal − printed; null when within paise rounding. */
  gap: number | null;
}

/**
 * The purchase form's total for a read bill against the printed payable, the same check the
 * web and phone forms show. A bill whose price basis was not settled is tried both ways and
 * the closer one counts. Null when the bill has no printed total or no lines.
 */
export function extractionTotalCheck(extract: IndianGstInvoiceExtract): ExtractionTotalCheck | null {
  const review = transformExtractToPurchaseReviewFormat(extract);
  const printed = scanPrintedGrandTotal(review.totals);
  if (printed == null || review.items.length === 0) return null;
  const lines = purchaseFormLinesFromScan(review.items as unknown as Record<string, unknown>[]);
  const roundOff = review.totals.round_off ?? 0;
  const mode = scanDocumentPriceMode(review.invoice.price_mode);
  const modes = mode === 'unknown' ? (['inclusive', 'exclusive'] as const) : [mode];
  let best: ExtractionTotalCheck | null = null;
  for (const m of modes) {
    const doc = previewPurchaseFormDocument(lines, m, { supplierStateCode: '00', companyStateCode: '00' });
    const linesTotal = round2(doc.grandTotalLines + roundOff);
    const check = { printed, linesTotal, gap: billTotalGap(printed, linesTotal) };
    if (!best || Math.abs(linesTotal - printed) < Math.abs(best.linesTotal - best.printed)) best = check;
  }
  return best;
}

/** Added to the vision prompt for the second read of a bill whose lines missed its total. */
export function totalRecheckNote(check: ExtractionTotalCheck, itemCount: number): string {
  return [
    '## SECOND READING — THE FIRST READING DID NOT ADD UP',
    `A first reading of this image found ${itemCount} item rows whose amounts come to ₹${check.linesTotal.toFixed(2)}, but the bill prints a total payable of ₹${check.printed.toFixed(2)} (₹${Math.abs(check.linesTotal - check.printed).toFixed(2)} ${check.linesTotal > check.printed ? 'too much' : 'missing'}).`,
    'Read the bill again from the top, row by row. For every row re-read the quantity (with its decimals), the rate and the printed amount, and check qty × rate ≈ amount. Look for a row that was skipped, read twice, shifted onto its neighbour, or has a misread digit.',
    'Do not invent or adjust numbers to force the total. Report what is printed.',
  ].join('\n');
}

/** The read whose lines are closer to the printed total; the first read wins a tie. */
export function closerToPrintedTotal<T>(
  first: { result: T; check: ExtractionTotalCheck | null },
  second: { result: T; check: ExtractionTotalCheck | null },
): T {
  if (!second.check) return first.result;
  if (!first.check) return second.result;
  const a = Math.abs(first.check.linesTotal - first.check.printed);
  const b = Math.abs(second.check.linesTotal - second.check.printed);
  return b < a ? second.result : first.result;
}
