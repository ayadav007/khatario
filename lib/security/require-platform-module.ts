/**
 * Server-side platform module gates for API routes.
 * Ensures business_modules + operational module subscription before data access.
 */

import { NextResponse } from 'next/server';
import {
  assertModuleAccess,
  FeatureAccessDeniedError,
} from '@/lib/subscription/feature-access';
import type { PlatformModule } from '@/lib/platform-modules';

export async function requirePlatformModule(
  businessId: string,
  moduleKey: PlatformModule,
  contextKey: string,
): Promise<void> {
  await assertModuleAccess(businessId, moduleKey, contextKey);
}

export function platformModuleErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof FeatureAccessDeniedError) {
    return error.toNextResponse();
  }
  return null;
}
