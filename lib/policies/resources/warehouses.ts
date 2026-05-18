/**
 * Warehouse Policies
 * 
 * PBAC policies for warehouse operations.
 * These policies wrap RBAC and add business rule checks.
 * 
 * Key Rules:
 * - Warehouse access is mandatory
 * - Branch alignment is enforced
 * - Warehouse must be active
 * - Business ownership is validated
 */

import { Policy } from '../types';
import {
  userHasWarehouseAccess,
  userHasBranchAccess,
  resourceBelongsToBusiness,
  customCondition,
} from '../conditions';

/**
 * Condition: Warehouse must be active
 */
function warehouseIsActive(): any {
  return customCondition(
    'warehouse_is_active',
    'Warehouse must be active',
    async (user: any, resource: any, context: any) => {
      const warehouse = resource;
      if (!warehouse) {
        return true; // Cannot validate without warehouse
      }
      // Check if warehouse is active (assuming is_active field)
      return warehouse.is_active !== false;
    },
    'Warehouse is not active',
    'WAREHOUSE_INACTIVE'
  );
}

/**
 * Condition: Warehouse must be accessible by user's branch
 */
function warehouseAccessibleByUserBranch(): any {
  return customCondition(
    'warehouse_accessible_by_user_branch',
    'Warehouse must be accessible by user\'s branch',
    async (user: any, resource: any, context: any) => {
      const warehouseId = resource.id || resource.warehouse_id || context.warehouseId;
      const branchId = resource.branch_id || context.branchId;

      if (branchId) {
        const { checkUserBranchPermission } = await import('../../branch-access');
        return await checkUserBranchPermission(user.id, branchId, 'view');
      }

      // Verify the warehouse is actually linked to one of the user's branches
      if (warehouseId && user.branch_ids && user.branch_ids.length > 0) {
        const { isWarehouseAccessibleByBranch } = await import('../../warehouse-access');
        for (const bid of user.branch_ids) {
          const accessible = await isWarehouseAccessibleByBranch(warehouseId, bid);
          if (accessible) return true;
        }
        return false;
      }

      if (!warehouseId) {
        return false;
      }

      return false;
    },
    'Warehouse is not accessible by your branch',
    'WAREHOUSE_BRANCH_MISMATCH'
  );
}

/**
 * Get all warehouse policies
 */
export function getWarehousePolicies(): Policy[] {
  return [
    // READ policies
    {
      resource: 'warehouse',
      action: 'read',
      requiresPermission: 'warehouses.read', // Dedicated warehouse permissions
      priority: 10,
      conditions: [
        userHasWarehouseAccess(),
        resourceBelongsToBusiness(),
        warehouseIsActive(),
      ],
    },

    // CREATE policies
    {
      resource: 'warehouse',
      action: 'create',
      requiresPermission: 'warehouses.create', // Dedicated warehouse permissions
      priority: 10,
      conditions: [
        // Branch access is checked in authorize() via context.branchId (RBAC level)
        resourceBelongsToBusiness(),
        // If branch_id provided, validate branch access
        warehouseAccessibleByUserBranch(),
      ],
    },

    // UPDATE policies
    {
      resource: 'warehouse',
      action: 'update',
      requiresPermission: 'warehouses.update', // Dedicated warehouse permissions
      priority: 10,
      conditions: [
        userHasWarehouseAccess(),
        resourceBelongsToBusiness(),
        warehouseIsActive(),
        warehouseAccessibleByUserBranch(),
      ],
    },

    // DELETE policies
    {
      resource: 'warehouse',
      action: 'delete',
      requiresPermission: 'warehouses.delete', // Dedicated warehouse permissions
      priority: 10,
      conditions: [
        userHasWarehouseAccess(),
        resourceBelongsToBusiness(),
        warehouseIsActive(),
        warehouseAccessibleByUserBranch(),
        // TODO: Add condition to check if warehouse has stock or active transfers
      ],
    },
  ];
}
