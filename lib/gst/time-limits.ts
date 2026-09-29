/**
 * Statutory GST time limits that depend on the financial year of the original document.
 *
 * - s.34(2): a credit note may reduce output tax only if declared by 30 November following
 *   the end of the FY of the supply (or the annual return date, if earlier).
 * - s.16(4): ITC on an invoice / debit note cannot be taken after 30 November following the
 *   end of the FY to which it pertains (or the annual return date, if earlier).
 *
 * The annual-return alternative is not tracked in the application, so the 30 November date is
 * the outer limit applied here.
 */

export function toIsoDate(d: Date | string): string {
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
}

/** Calendar year in which the Indian FY (April–March) containing `date` ends. */
export function fyEndYear(date: Date | string): number {
  const iso = toIsoDate(date);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return month >= 4 ? year + 1 : year;
}

/** Last date (inclusive) for s.34(2) tax reduction / s.16(4) ITC on a document of `docDate`. */
export function thirtyNovAfterFy(docDate: Date | string): string {
  return `${fyEndYear(docDate)}-11-30`;
}

export function isCreditNoteTaxReductionTimeBarred(originalInvoiceDate: Date | string, creditNoteDate: Date | string): boolean {
  return toIsoDate(creditNoteDate) > thirtyNovAfterFy(originalInvoiceDate);
}

export function isItcTimeBarred(documentDate: Date | string, claimDate: Date | string): boolean {
  return toIsoDate(claimDate) > thirtyNovAfterFy(documentDate);
}

/** Today in India (the date a claim is being made in the books). */
export function todayIst(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
