import { queryOne } from '@/lib/db';
import { hasTableColumn } from '@/lib/schema-columns';
import { normalizeDocumentLanguage, type DocumentLanguage } from './codes';

export async function getBusinessDocumentLanguage(businessId: string | null | undefined): Promise<DocumentLanguage> {
  if (!businessId) return 'en';
  try {
    const exists = await hasTableColumn('business_settings', 'document_language');
    if (!exists) return 'en';
    const row = await queryOne<{ document_language: string | null }>(
      `SELECT document_language FROM business_settings WHERE business_id = $1`,
      [businessId],
    );
    return normalizeDocumentLanguage(row?.document_language);
  } catch (error) {
    console.error('[print-language] Failed to read document language:', error);
    return 'en';
  }
}

export async function resolveDocumentLanguage(
  explicit: unknown,
  businessId: string | null | undefined,
): Promise<DocumentLanguage> {
  if (explicit != null && String(explicit).trim() !== '') {
    return normalizeDocumentLanguage(explicit);
  }
  return getBusinessDocumentLanguage(businessId);
}
