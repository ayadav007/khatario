/**
 * Central Authorization Layer
 * 
 * SINGLE SOURCE OF TRUTH for all authorization checks.
 * 
 * Rules:
 * - ALL access checks MUST go through authorize()
 * - No controller/service may bypass this
 * - No inline permission logic allowed
 * - Missing permission → throws AuthorizationError (403)
 * 
 * PBAC Integration:
 * - RBAC check happens FIRST
 * - Policy evaluation happens SECOND
 * - If either fails → deny access
 * - Missing policy → default DENY
 * 
 * Usage:
 *   await authorize(userId, 'invoices', 'create');
 *   await authorize(userId, 'invoices', 'update', { resourceId: invoiceId });
 */

import { NextResponse } from 'next/server';
import { checkUserPermission } from './permissions';
import { checkUserBranchPermission } from './branch-access';
import { checkUserWarehousePermission } from './warehouse-access';
import { queryOne } from './db';
import { evaluatePolicy } from './policies/engine';
import { PolicyUser, PolicyContext } from './policies/types';
import { getPolicyRegistry } from './policies/registry';
import { assertFeatureAccess, FeatureAccessDeniedError } from './subscription/feature-access';
import { getHrRegistryFeatureForAuthModule } from './hr-plan-features';
import { clearSessionCookie } from './jwt';
import { assertSessionValidForCookieAuth } from './auth-helpers';

export class AuthorizationError extends Error {
  statusCode: number;
  code: string;
  details?: any;
  
  constructor(
    message: string,
    code: string = 'FORBIDDEN',
    details?: any,
    statusCode: number = 403
  ) {
    super(message);
    this.name = 'AuthorizationError';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
  
  toResponse() {
    return {
      error: this.message,
      code: this.code,
      details: this.details
    };
  }

  /** Use in route catch blocks so SESSION_REVOKED clears httpOnly cookies. */
  toNextResponse(): NextResponse {
    const res = NextResponse.json(this.toResponse(), { status: this.statusCode });
    if (this.code === 'SESSION_REVOKED') {
      clearSessionCookie(res);
    }
    return res;
  }
}

export interface AuthorizationContext {
  resourceId?: string;
  branchId?: string;
  warehouseId?: string;
  businessId?: string;
  [key: string]: any;
}

// Static allow-list of valid table names to prevent SQL injection
const TABLE_NAME_MAP: Record<string, string> = {
  'invoice': 'invoices',
  'invoices': 'invoices',
  'customer': 'customers',
  'customers': 'customers',
  'supplier': 'suppliers',
  'suppliers': 'suppliers',
  'item': 'items',
  'items': 'items',
  'inventory_adjustment': 'inventory_adjustments',
  'inventory_adjustments': 'inventory_adjustments',
  'warehouse': 'warehouses',
  'warehouses': 'warehouses',
  'warehouse_transfer': 'stock_transfers',
  'warehouse_transfers': 'stock_transfers',
  'stock_transfer': 'stock_transfers',
  'stock_transfers': 'stock_transfers',
  'purchase': 'purchases',
  'purchases': 'purchases',
  'payment': 'payments',
  'payments': 'payments',
  'expense': 'expenses',
  'expenses': 'expenses',
  'credit_note': 'credit_notes',
  'credit_notes': 'credit_notes',
  'journal': 'journal_entries',
  'journal_entries': 'journal_entries',
  'work_order': 'work_orders',
  'work_orders': 'work_orders',
  'employee': 'employees',
  'employees': 'employees',
};

export async function authorize(
  userId: string,
  moduleKey: string,
  action: 'read' | 'create' | 'update' | 'delete' | 'export' | 'finalize' | 'cancel' | 'adjust_quantity' | 'adjust_value' | 'dispatch' | 'receive' | 'lock' | 'unlock' | 'approve',
  context?: AuthorizationContext
): Promise<void> {
  const permissionKeyMap: Record<string, string> = {
    'read': 'read',
    'create': 'create',
    'update': 'update',
    'delete': 'delete',
    'export': 'export',
    'finalize': 'update',
    'cancel': 'delete',
    'adjust_quantity': 'create',
    'adjust_value': 'create',
    'dispatch': 'update',
    'receive': 'update',
    'lock': 'update',
    'unlock': 'update',
    'approve': 'update',
  };
  
  const permissionKey = permissionKeyMap[action];
  if (!permissionKey) {
    throw new AuthorizationError(
      `Invalid action: ${action}`,
      'INVALID_ACTION'
    );
  }

  await assertSessionValidForCookieAuth(userId);
  
  // ============================================
  // STEP 0: PRIMARY ADMIN SHORT-CIRCUIT
  // The business owner has full access to everything.
  // Skip RBAC + PBAC entirely to avoid unnecessary DB queries.
  // ============================================
  const callingUser = await queryOne<{ is_primary_admin: boolean; business_id: string }>(
    'SELECT is_primary_admin, business_id FROM users WHERE id = $1',
    [userId]
  );

  // Subscription plan must include HR features (applies to all users, including primary admin)
  const hrRegistryFeature = getHrRegistryFeatureForAuthModule(moduleKey);
  if (hrRegistryFeature) {
    const businessIdForFeature = context?.businessId || callingUser?.business_id;
    if (!businessIdForFeature) {
      throw new AuthorizationError(
        'businessId is required for HR operations',
        'BUSINESS_REQUIRED'
      );
    }
    try {
      await assertFeatureAccess(businessIdForFeature, hrRegistryFeature);
    } catch (e) {
      if (e instanceof FeatureAccessDeniedError) {
        throw new AuthorizationError(
          'This HR feature is not included in your subscription plan.',
          'FEATURE_NOT_IN_PLAN',
          e.toResponse()
        );
      }
      throw e;
    }
  }

  if (callingUser?.is_primary_admin) {
    return;
  }
  
  // ============================================
  // STEP 1: RBAC CHECK
  // ============================================
  
  let skipRBACForBootstrap = false;
  if (moduleKey === 'settings' && action === 'create') {
    if (callingUser?.business_id) {
      const roleCount = await queryOne<{ count: string }>(
        'SELECT COUNT(*) as count FROM user_roles WHERE business_id = $1',
        [callingUser.business_id]
      );
      if (parseInt(roleCount?.count || '0', 10) === 0) {
        skipRBACForBootstrap = true;
      }
    }
  }
  
  const permissionModuleMap: Record<string, string> = {
    'inventory_adjustment': 'items',
    'inventory_adjustments': 'items',
    'warehouse': 'warehouses',
    'warehouses': 'warehouses',
    'warehouse_transfer': 'warehouse_transfer',
    'warehouse_transfers': 'warehouse_transfer',
    'stock_transfer': 'warehouse_transfer',
    'stock_transfers': 'warehouse_transfer',
    'report': 'reports',
    'report.financial': 'reports',
    'report.inventory': 'reports',
    'report.gst': 'reports',
  };
  
  const permissionModule = permissionModuleMap[moduleKey] || moduleKey;
  
  if (!skipRBACForBootstrap) {
    const hasPermission = await checkUserPermission(userId, permissionModule, permissionKey);
    
    if (!hasPermission) {
      throw new AuthorizationError(
        `User does not have ${action} permission for ${permissionModule}`,
        'PERMISSION_DENIED'
      );
    }
  }
  
  if (context?.branchId) {
    const branchPermission = action === 'read' ? 'view' : 'create_transactions';
    const hasBranchAccess = await checkUserBranchPermission(userId, context.branchId, branchPermission);
    
    if (!hasBranchAccess) {
      throw new AuthorizationError(
        `User does not have ${branchPermission} permission for branch ${context.branchId}`,
        'BRANCH_ACCESS_DENIED'
      );
    }
  }
  
  if (context?.warehouseId) {
    const warehousePermission = action === 'read' ? 'view' : 'create_transactions';
    const hasWarehouseAccess = await checkUserWarehousePermission(userId, context.warehouseId, warehousePermission);
    
    if (!hasWarehouseAccess) {
      throw new AuthorizationError(
        `User does not have ${warehousePermission} permission for warehouse ${context.warehouseId}`,
        'WAREHOUSE_ACCESS_DENIED'
      );
    }
  }

  // ============================================
  // STEP 2: PBAC POLICY EVALUATION
  // ============================================
  
  const policyResourceMap: Record<string, string> = {
    'reports': 'report',
    'report': 'report',
    'report.financial': 'report.financial',
    'report.inventory': 'report.inventory',
    'report.gst': 'report.gst',
    'warehouses': 'warehouse',
    'warehouse': 'warehouse',
  };
  
  const policyResource = policyResourceMap[moduleKey] || moduleKey;
  
  const policyRegistry = getPolicyRegistry();
  let policies = policyRegistry.getPolicies(policyResource, action);
  
  if (policies.length === 0 && policyResource !== moduleKey) {
    policies = policyRegistry.getPolicies(moduleKey, action);
  }
  
  const PBAC_DEFAULT_DENY = process.env.PBAC_DEFAULT_DENY !== 'false';
  
  if (policies.length === 0) {
    if (PBAC_DEFAULT_DENY) {
      throw new AuthorizationError(
        `Access denied: No policy defined for resource '${moduleKey}' action '${action}'`,
        'NO_POLICY_DEFINED',
        {
          resource: moduleKey,
          action,
          message: 'This resource/action combination requires a PBAC policy to be defined.',
        }
      );
    } else {
      return;
    }
  }

  const user = callingUser ? 
    await queryOne<{ business_id: string; role_id?: string }>(
      'SELECT business_id, role_id FROM users WHERE id = $1',
      [userId]
    ) : null;

  if (!user) {
    throw new AuthorizationError('User not found', 'USER_NOT_FOUND');
  }

  const { getUserBranches } = await import('./branch-access');
  const { getUserWarehouses } = await import('./warehouse-access');
  const userBranches = await getUserBranches(userId);
  const userWarehouses = await getUserWarehouses(userId);

  const policyUser: PolicyUser = {
    id: userId,
    business_id: user.business_id,
    role_id: user.role_id || undefined,
    branch_ids: userBranches.map(b => b.branch_id),
    warehouse_ids: userWarehouses.map(w => w.warehouse_id),
  };

  // Fetch resource with tenant filter to prevent cross-tenant reads
  let resource: any = null;
  if (context?.resourceId) {
    const tableName = TABLE_NAME_MAP[moduleKey];
    if (tableName) {
      try {
        resource = await queryOne(
          `SELECT * FROM ${tableName} WHERE id = $1 AND business_id = $2`,
          [context.resourceId, user.business_id]
        );
      } catch {
        resource = null;
      }
    }
    // If moduleKey not in TABLE_NAME_MAP, skip resource fetch (no dynamic table names)
  }

  if (!resource && moduleKey === 'inventory_adjustment' && context) {
    let branchId: string | undefined = context.branchId;
    if (!branchId && context.warehouseId) {
      try {
        const warehouse = await queryOne<{ branch_id: string | null }>(
          'SELECT branch_id FROM warehouses WHERE id = $1',
          [context.warehouseId]
        );
        branchId = warehouse?.branch_id || undefined;
      } catch {
        // branchId remains undefined
      }
    }
    
    resource = {
      location_id: context.warehouseId,
      warehouse_id: context.warehouseId,
      business_id: context.businessId || user.business_id,
      branch_id: branchId,
      adjustment_date: context.adjustment_date,
      adjustment_type: context.adjustment_type,
    };
  }

  if (!resource && (moduleKey === 'warehouse_transfer' || moduleKey === 'stock_transfer' || moduleKey === 'warehouse_transfers' || moduleKey === 'stock_transfers') && context) {
    resource = {
      from_location_id: context.sourceWarehouseId || context.from_location_id,
      to_location_id: context.destinationWarehouseId || context.to_location_id,
      business_id: context.businessId || user.business_id,
      transfer_date: context.transfer_date,
      status: context.status || 'pending',
    };
  }

  const policyContext: PolicyContext = {
    resource: resource || {},
    action,
    businessId: context?.businessId || user.business_id,
    branchId: context?.branchId || resource?.branch_id,
    warehouseId: context?.warehouseId || resource?.warehouse_id || resource?.location_id,
    sourceWarehouseId: context?.sourceWarehouseId || resource?.from_location_id || resource?.from_warehouse_id,
    destinationWarehouseId: context?.destinationWarehouseId || resource?.to_location_id || resource?.to_warehouse_id,
    ...context,
  };

  let policyPassed = false;
  let lastError: any = null;

  for (const policy of policies) {
    const expectedPermission = `${moduleKey}.${permissionKey}`;
    const expectedPermissionPlural = `${moduleKey}s.${permissionKey}`;
    
    const expectedApprovePermission = action === 'approve' ? `${moduleKey}.approve` : null;
    const expectedApprovePermissionPlural = action === 'approve' ? `${moduleKey}s.approve` : null;
    
    const isBootstrapPolicy = policy.conditions?.some(c => c.id === 'business_has_zero_roles');
    const permissionMatches = 
      policy.requiresPermission === expectedPermission || 
      policy.requiresPermission === expectedPermissionPlural ||
      (expectedApprovePermission && policy.requiresPermission === expectedApprovePermission) ||
      (expectedApprovePermissionPlural && policy.requiresPermission === expectedApprovePermissionPlural);
    
    if (!permissionMatches && !isBootstrapPolicy) {
      continue;
    }

    const result = await evaluatePolicy(policy, policyUser, policyContext);

    if (result.allowed) {
      policyPassed = true;
      break;
    } else {
      lastError = {
        errorMessage: result.errorMessage || 'Policy evaluation failed',
        errorCode: result.errorCode || 'POLICY_DENIED',
        policyId: `${policy.resource}:${policy.action}`,
        conditionId: result.failedCondition?.id,
        conditionDescription: result.failedCondition?.description,
      };
    }
  }

  if (!policyPassed && lastError) {
    throw new AuthorizationError(
      lastError.errorMessage || 'Policy evaluation failed',
      lastError.errorCode || 'POLICY_DENIED',
      {
        policyId: lastError.policyId,
        conditionId: lastError.conditionId,
        conditionDescription: lastError.conditionDescription,
        message: lastError.errorMessage || 'Policy evaluation failed',
      }
    );
  }
}

export async function assertPermission(
  userId: string,
  moduleKey: string,
  action: 'read' | 'create' | 'update' | 'delete' | 'export',
  context?: AuthorizationContext
): Promise<void> {
  return authorize(userId, moduleKey, action, context);
}

export async function hasPermission(
  userId: string,
  moduleKey: string,
  action: 'read' | 'create' | 'update' | 'delete' | 'export',
  context?: AuthorizationContext
): Promise<boolean> {
  try {
    await authorize(userId, moduleKey, action, context);
    return true;
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return false;
    }
    throw error;
  }
}
