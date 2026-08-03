import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getRegularizationSettings,
  saveRegularizationSettings,
} from '@/lib/hr/attendance-regularization';
import { DEFAULT_REGULARIZATION_SETTINGS } from '@/lib/hr/attendance-regularization-shared';
import type { RegularizationSettings } from '@/lib/hr/attendance-regularization-shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'read', { businessId });
    const settings = await getRegularizationSettings(businessId);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'update', { businessId });

    const body = await request.json();
    const partial: Partial<RegularizationSettings> = {};
    if (body && typeof body === 'object') {
      for (const key of Object.keys(DEFAULT_REGULARIZATION_SETTINGS) as (keyof RegularizationSettings)[]) {
        if (body[key] !== undefined) {
          (partial as Record<string, unknown>)[key] = body[key];
        }
      }
    }
    const settings = await saveRegularizationSettings(businessId, partial);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
