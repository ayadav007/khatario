import { queryOne } from '@/lib/db';
import { FeatureKeys } from '@/lib/featureKeys';
import { hasTableColumn } from '@/lib/schema-columns';
import { hasFeatureAccess } from '@/lib/subscription/feature-access';
import {
  applyDocumentLanguageEntitlement,
  normalizeDocumentLanguage,
  type DocumentLanguage,
} from './codes';

export { applyDocumentLanguageEntitlement };

async function readSavedDocumentLanguage(businessId: string): Promise<DocumentLanguage> {
  const exists = await hasTableColumn('business_settings', 'document_language');
  if (!exists) return 'en';
  const row = await queryOne<{ document_language: string | null }>(
    `SELECT document_language FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  return normalizeDocumentLanguage(row?.document_language);
}

/** True when the business plan has Print language enabled in the feature matrix. */
export async function documentLanguageChangeAllowed(
  businessId: string | null | undefined,
): Promise<boolean> {
  if (!businessId) return false;
  try {
    return await hasFeatureAccess(businessId, FeatureKeys.DOCUMENT_LANGUAGE);
  } catch (error) {
    console.error('[print-language] Failed to read print-language entitlement:', error);
    return false;
  }
}

export async function getBusinessDocumentLanguage(businessId: string | null | undefined): Promise<DocumentLanguage> {
  if (!businessId) return 'en';
  try {
    const [saved, allowed] = await Promise.all([
      readSavedDocumentLanguage(businessId),
      documentLanguageChangeAllowed(businessId),
    ]);
    return applyDocumentLanguageEntitlement(saved, allowed);
  } catch (error) {
    console.error('[print-language] Failed to read document language:', error);
    return 'en';
  }
}

export async function resolveDocumentLanguage(
  explicit: unknown,
  businessId: string | null | undefined,
): Promise<DocumentLanguage> {
  const chosen =
    explicit != null && String(explicit).trim() !== ''
      ? normalizeDocumentLanguage(explicit)
      : await getBusinessDocumentLanguage(businessId);
  if (!businessId) return chosen;
  if (explicit != null && String(explicit).trim() !== '') {
    const allowed = await documentLanguageChangeAllowed(businessId);
    return applyDocumentLanguageEntitlement(chosen, allowed);
  }
  return chosen;
}
