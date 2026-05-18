import { hasFeatureAccess } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';

/**
 * Whether tenant write paths should use soft-delete (archive) vs hard delete.
 *
 * Uses {@link hasFeatureAccess} only — never {@link assertFeatureAccess}, so denial
 * returns false and never throws (branching/control flow, not API enforcement).
 */
export async function shouldUseSoftDelete(businessId: string): Promise<boolean> {
  return hasFeatureAccess(businessId, FeatureKeys.SOFT_DELETE);
}
