import { NextRequest, NextResponse } from 'next/server';
import { createImportedItem, type ImportItemInput } from '@/lib/items/create-imported-item';
import {
  getUserIdFromRequest,
  requireTenantBusinessId,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { checkLimit } from '@/lib/subscription';
import { noteShopChanged } from '@/lib/rag/tenant-reindex';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id: claimedBusinessId, items } = body as {
      business_id?: string;
      items?: ImportItemInput[];
    };

    const tenant = requireTenantBusinessId(request, claimedBusinessId);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;

    const userId = getUserIdFromRequest(request, body);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items to import' }, { status: 400 });
    }

    try {
      await authorize(userId, 'items', 'create');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await enforceAccess({
        businessId: business_id,
        userId,
        limitType: 'items',
      });
    } catch (error) {
      const res = enforceAccessErrorResponse(error);
      if (res) return res;
      throw error;
    }

    const limitCheck = await checkLimit(business_id, 'items');
    if (
      !limitCheck.allowed ||
      (limitCheck.limit >= 0 && limitCheck.current + items.length > limitCheck.limit)
    ) {
      return NextResponse.json(
        {
          error: limitCheck.message || 'Item limit would be exceeded by this import',
          limit: limitCheck.limit,
          current: limitCheck.current,
          code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
          limit_type: 'items',
        },
        { status: 403 }
      );
    }

    let success = 0;
    let failed = 0;
    const errors: { row: number; reason: string }[] = [];

    for (let i = 0; i < items.length; i++) {
      const row = items[i];
      if (!row.name) {
        failed++;
        errors.push({ row: i + 1, reason: 'Missing name' });
        continue;
      }
      try {
        const result = await createImportedItem({ businessId: business_id, userId }, row);
        if (!result.ok) {
          failed++;
          errors.push({ row: i + 1, reason: result.error });
          continue;
        }
        success++;
      } catch (err: any) {
        failed++;
        errors.push({ row: i + 1, reason: err.message || 'Insert failed' });
      }
    }

    if (success > 0) noteShopChanged(business_id, 'items imported');
    return NextResponse.json({ success, failed, errors });
  } catch (error: any) {
    console.error('Import error', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
