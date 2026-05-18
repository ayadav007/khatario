import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/authorization/preview
 * 
 * Read-only authorization preview endpoint for UI checks.
 * Does NOT perform mutations - only checks if user would be allowed.
 * 
 * Query parameters:
 * - user_id: User ID to check
 * - resource: Resource/module key (e.g., 'settings', 'invoices', 'employees')
 * - action: Action to check (e.g., 'create', 'update', 'delete')
 * - resource_id: (optional) Resource ID for ownership checks
 * - branch_id: (optional) Branch ID for branch context
 * - warehouse_id: (optional) Warehouse ID for warehouse context
 * - business_id: (optional) Business ID for business context
 * 
 * Returns:
 * {
 *   allowed: boolean,
 *   reason?: string,
 *   code?: string
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const userId = getUserIdFromRequest(request);
    const resource = searchParams.get('resource');
    const action = searchParams.get('action') as any;
    
    if (!userId) {
      return NextResponse.json(
        { allowed: false, reason: 'user_id is required', code: 'MISSING_USER_ID' },
        { status: 400 }
      );
    }
    
    if (!resource) {
      return NextResponse.json(
        { allowed: false, reason: 'resource is required', code: 'MISSING_RESOURCE' },
        { status: 400 }
      );
    }
    
    if (!action) {
      return NextResponse.json(
        { allowed: false, reason: 'action is required', code: 'MISSING_ACTION' },
        { status: 400 }
      );
    }
    
    const context: Record<string, any> = {};
    if (searchParams.get('resource_id')) {
      context.resourceId = searchParams.get('resource_id');
    }
    if (searchParams.get('branch_id')) {
      context.branchId = searchParams.get('branch_id');
    }
    if (searchParams.get('warehouse_id')) {
      context.warehouseId = searchParams.get('warehouse_id');
    }
    const previewBusinessId = getBusinessIdFromRequest(request);
    if (previewBusinessId) {
      context.businessId = previewBusinessId;
    }
    
    try {
      await authorize(userId, resource, action, Object.keys(context).length > 0 ? context : undefined);
      return NextResponse.json({ allowed: true });
    } catch (error: any) {
      if (error instanceof AuthorizationError) {
        return NextResponse.json({
          allowed: false,
          reason: error.message,
          code: error.code || 'FORBIDDEN',
          details: error.details
        });
      }
      throw error;
    }
  } catch (error: any) {
    console.error('Authorization preview error:', error);
    return NextResponse.json(
      {
        allowed: false,
        reason: error.message || 'Authorization check failed',
        code: 'AUTHORIZATION_ERROR'
      },
      { status: 500 }
    );
  }
}
