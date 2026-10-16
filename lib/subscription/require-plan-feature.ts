import { NextResponse } from 'next/server';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * For API routes that do not go through authorize() (so the path gate does not run):
 * returns a 403 response when the business's plan lacks `featureId`, otherwise null.
 */
export async function planFeatureDeniedResponse(businessId: string, featureId: string): Promise<NextResponse | null> {
  try {
    await assertFeatureAccess(businessId, featureId);
    return null;
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
    throw error;
  }
}
