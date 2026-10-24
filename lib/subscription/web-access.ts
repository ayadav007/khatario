import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

export const WEB_ACCESS_FEATURE = 'web_access';

/**
 * Whether the business may use Khatario in a browser. The Free Billing plan lacks `web_access`
 * (phone app only). Allowed when the feature does not exist yet (before migration 387) or the
 * business has no Billing module (HR-only / Connect-only businesses).
 */
export async function businessHasWebAccess(businessId: string): Promise<boolean> {
  const feature = await db.queryOne<{ id: string }>(
    `SELECT id FROM platform_features WHERE id = $1 AND is_active = true`,
    [WEB_ACCESS_FEATURE],
  );
  if (!feature) return true;

  const billing = await db.queryOne<{ enabled: boolean }>(
    `SELECT enabled FROM business_modules WHERE business_id = $1 AND module_key = 'billing'`,
    [businessId],
  );
  if (billing?.enabled !== true) return true;

  try {
    await assertFeatureAccess(businessId, WEB_ACCESS_FEATURE);
    return true;
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) return false;
    throw error;
  }
}
