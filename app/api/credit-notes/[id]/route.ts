import { rejectDocumentDateChange } from '@/lib/gst/document-dates';

export const dynamic = 'force-dynamic';

export async function PUT() {
  return rejectDocumentDateChange('credit note');
}

export async function PATCH() {
  return rejectDocumentDateChange('credit note');
}
