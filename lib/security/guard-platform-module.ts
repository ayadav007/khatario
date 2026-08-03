/**
 * Route-level platform module guard for handlers that cannot use authorize().
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getBusinessIdFromRequest,
  getSessionScopedBusinessId,
} from '@/lib/auth-helpers';
import {
  requirePlatformModule,
  platformModuleErrorResponse,
} from '@/lib/security/require-platform-module';
import type { PlatformModule } from '@/lib/platform-modules';

export async function guardPlatformModule(
  request: NextRequest,
  moduleKey: PlatformModule,
  contextKey: string,
  businessId?: string | null,
): Promise<NextResponse | null> {
  const resolved =
    businessId ??
    getSessionScopedBusinessId(request) ??
    getBusinessIdFromRequest(request);

  if (!resolved) {
    return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
  }

  try {
    await requirePlatformModule(resolved, moduleKey, contextKey);
    return null;
  } catch (error) {
    const denied = platformModuleErrorResponse(error);
    if (denied) return denied;
    throw error;
  }
}
