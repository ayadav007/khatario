import { rejectDocumentDateChange } from '@/lib/gst/document-dates';

export const dynamic = 'force-dynamic';

/**
 * A debit note date cannot be changed after it is saved.
 * Cancellation is PATCH /api/debit-notes/[id]/cancel. It reverses the voucher
 * and marks GSTR-1, GSTR-3B, and the financial-year GSTR-9 stale.
 */
export async function PUT() {
  return rejectDocumentDateChange('debit note');
}

export async function PATCH() {
  return rejectDocumentDateChange('debit note');
}
