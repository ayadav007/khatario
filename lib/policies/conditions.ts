/**
 * Common Policy Conditions
 * 
 * Reusable condition evaluators for common business rules.
 * All conditions fail CLOSED on error (deny access when uncertain).
 */

import { PolicyUser, PolicyContext, PolicyCondition } from './types';
import { queryOne } from '../db';

/**
 * Condition: User must have access to the resource's branch
 */
export function userHasBranchAccess(): PolicyCondition {
  return {
    id: 'user_has_branch_access',
    description: 'User must have access to the resource branch',
    errorMessage: 'You do not have access to this branch',
    errorCode: 'BRANCH_ACCESS_DENIED',
    evaluate: async (user: PolicyUser, resource: any, context: PolicyContext) => {
      const branchId = resource.branch_id || context.branchId;
      if (!branchId) {
        // For read operations, allow when no branch is specified (list views)
        // For write operations, deny when no branch is specified
        const action = (context as any).action;
        if (action === 'read') return true;
        return false;
      }

      const { checkUserBranchPermission } = await import('../branch-access');
      return await checkUserBranchPermission(user.id, branchId, 'view');
    },
  };
}

/**
 * Condition: User must have access to the resource's warehouse.
 * Checks 'create_transactions' for write operations, 'view' for reads.
 */
export function userHasWarehouseAccess(): PolicyCondition {
  return {
    id: 'user_has_warehouse_access',
    description: 'User must have access to the resource warehouse',
    errorMessage: 'You do not have access to this warehouse',
    errorCode: 'WAREHOUSE_ACCESS_DENIED',
    evaluate: async (user: PolicyUser, resource: any, context: PolicyContext) => {
      const warehouseId = resource.warehouse_id || resource.location_id || context.warehouseId;
      if (!warehouseId) {
        const action = (context as any).action;
        if (action === 'read' || action === 'export') return true;
        return false;
      }

      const { checkUserWarehousePermission } = await import('../warehouse-access');
      const action = (context as any).action;
      const permission = (action === 'read' || action === 'export') ? 'view' : 'create_transactions';
      return await checkUserWarehousePermission(user.id, warehouseId, permission);
    },
  };
}

/**
 * Condition: Resource status must match allowed statuses
 */
export function resourceStatusIs(
  allowedStatuses: string[],
  errorMessage?: string
): PolicyCondition {
  return {
    id: `resource_status_is_${allowedStatuses.join('_')}`,
    description: `Resource status must be one of: ${allowedStatuses.join(', ')}`,
    errorMessage: errorMessage || `Resource status must be one of: ${allowedStatuses.join(', ')}`,
    errorCode: 'INVALID_RESOURCE_STATUS',
    evaluate: async (user: PolicyUser, resource: any, context: PolicyContext) => {
      const status = resource.status;
      if (!status) {
        return false;
      }
      return allowedStatuses.includes(status);
    },
  };
}

/**
 * Condition: Resource status must NOT be in disallowed statuses
 */
export function resourceStatusIsNot(
  disallowedStatuses: string[],
  errorMessage?: string
): PolicyCondition {
  return {
    id: `resource_status_is_not_${disallowedStatuses.join('_')}`,
    description: `Resource status must not be one of: ${disallowedStatuses.join(', ')}`,
    errorMessage: errorMessage || `Cannot perform action on resource with status: ${disallowedStatuses.join(', ')}`,
    errorCode: 'INVALID_RESOURCE_STATUS',
    evaluate: async (user: PolicyUser, resource: any, context: PolicyContext) => {
      const status = resource.status;
      if (!status) {
        return true;
      }
      return !disallowedStatuses.includes(status);
    },
  };
}

/**
 * Condition: Accounting period must be open for the resource date.
 * Fails CLOSED: if the check errors out, the period is treated as locked.
 */
export function accountingPeriodIsOpen(
  dateField: string = 'invoice_date'
): PolicyCondition {
  return {
    id: 'accounting_period_is_open',
    description: 'Accounting period for the resource date must be open',
    errorMessage: 'Cannot modify entries in a locked accounting period',
    errorCode: 'PERIOD_LOCKED',
    evaluate: async (user: PolicyUser, resource: any, context: PolicyContext) => {
      const date = resource[dateField] || context[dateField];
      if (!date) {
        const action = (context as any).action;
        if (action === 'read' || action === 'export' || action === 'create') return true;
        return false; // Fail closed: require date for update/delete/finalize/cancel
      }

      const businessId = resource.business_id || context.businessId || user.business_id;
      const branchId = resource.branch_id || context.branchId;

      if (!businessId) {
        return false;
      }

      try {
        const { isPeriodLocked } = await import('../period-lock-utils');
        const locked = await isPeriodLocked(businessId, branchId, date);
        return !locked;
      } catch (error) {
        console.error('Error checking period lock:', error);
        return false;
      }
    },
  };
}

/**
 * Condition: Resource must belong to user's business.
 * Fails CLOSED: if business_id is missing from both resource and context, deny.
 */
export function resourceBelongsToBusiness(): PolicyCondition {
  return {
    id: 'resource_belongs_to_business',
    description: 'Resource must belong to user\'s business',
    errorMessage: 'Resource does not belong to your business',
    errorCode: 'RESOURCE_BUSINESS_MISMATCH',
    evaluate: async (user: PolicyUser, resource: any, context: PolicyContext) => {
      const resourceBusinessId = resource.business_id || context.businessId;
      if (!resourceBusinessId) {
        // For create operations, the business_id is often set server-side
        // after authorization. Allow if the caller explicitly provided businessId
        // in context and it matches the user's business.
        if (context.businessId && context.businessId === user.business_id) {
          return true;
        }
        return false;
      }
      return resourceBusinessId === user.business_id;
    },
  };
}

/**
 * Condition: Allow bootstrap mode when business has zero roles
 */
export function businessHasZeroRoles(): PolicyCondition {
  return {
    id: 'business_has_zero_roles',
    description: 'Business must have zero roles (bootstrap mode)',
    errorMessage: 'Bootstrap mode only available when business has no roles.',
    errorCode: 'BOOTSTRAP_MODE_EXPIRED',
    evaluate: async (user: PolicyUser, resource: any, context: PolicyContext) => {
      const businessId = resource.business_id || context.businessId || user.business_id;
      if (!businessId) {
        return false;
      }

      try {
        const roleCount = await queryOne<{ count: string }>(
          'SELECT COUNT(*) as count FROM user_roles WHERE business_id = $1',
          [businessId]
        );
        const count = parseInt(roleCount?.count || '0', 10);
        return count === 0;
      } catch (error) {
        console.error('Error checking role count:', error);
        return false;
      }
    },
  };
}

/**
 * Condition: Custom condition builder
 */
export function customCondition(
  id: string,
  description: string,
  evaluator: (user: PolicyUser, resource: any, context: PolicyContext) => Promise<boolean> | boolean,
  errorMessage: string,
  errorCode: string = 'POLICY_CONDITION_FAILED'
): PolicyCondition {
  return {
    id,
    description,
    evaluate: evaluator,
    errorMessage,
    errorCode,
  };
}
