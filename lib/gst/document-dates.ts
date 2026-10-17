import { NextResponse } from 'next/server';

/**
 * Purchases, credit notes, debit notes and purchase returns are not edited in place.
 * A date change would have to be a cancel plus a new document so both periods are explicit.
 */
export function rejectDocumentDateChange(documentLabel: string) {
  return NextResponse.json(
    {
      error: `The ${documentLabel} date cannot be changed. Cancel the document and record a new one.`,
      code: 'DOCUMENT_DATE_IMMUTABLE',
    },
    { status: 405 }
  );
}

/**
 * A final invoice can be saved again with a new date. Both the old and new dates
 * are returned so monthly and annual readiness can be marked for each.
 */
export function invoiceReadinessSpan(input: {
  priorStatus: string | null;
  priorDate: string | null;
  nextStatus: string;
  nextDate: string | null;
}): { from: string | null; to: string | null } | null {
  if (input.nextStatus !== 'final') return null;
  return {
    from: input.priorStatus === 'final' && input.priorDate ? input.priorDate.slice(0, 10) : null,
    to: input.nextDate ? input.nextDate.slice(0, 10) : null,
  };
}
