import { rejectDocumentDateChange } from '@/lib/gst/document-dates';

export const dynamic = 'force-dynamic';

/**
 * A debit note date cannot be changed after it is saved.
 * Cancelling a debit note is not implemented: there is no cancel route,
 * so a posted debit note cannot be marked stale by cancellation.
 */
export async function PUT() {
  return rejectDocumentDateChange('debit note');
}

export async function PATCH() {
  return rejectDocumentDateChange('debit note');
}
