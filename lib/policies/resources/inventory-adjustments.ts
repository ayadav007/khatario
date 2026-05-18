/**
 * Inventory Adjustment Policies
 * 
 * PBAC policies for inventory adjustment operations.
 * These policies wrap RBAC and add business rule checks.
 * 
 * Key Rules:
 * - Quantity adjustments vs Value adjustments have different permission requirements
 * - Warehouse access is mandatory
 * - Period lock enforcement
 * - Stock freeze checks (if implemented)
 */

import { Policy } from '../types';
import {
  userHasWarehouseAccess,
  accountingPeriodIsOpen,
  resourceBelongsToBusiness,
  customCondition,
} from '../conditions';

/**
 * Condition: User must have permission for specific adjustment type
 * Quantity adjustments require 'inventory.adjust.quantity'
 * Value adjustments require 'inventory.adjust.value'
 */
function userHasAdjustmentTypePermission(adjustmentType: 'QUANTITY' | 'VALUE'): any {
  return customCondition(
    `user_has_${adjustmentType.toLowerCase()}_adjustment_permission`,
    `User must have permission for ${adjustmentType} adjustments`,
    async (user: any, resource: any, context: any) => {
      // This will be checked at RBAC level via different actions
      // For now, we assume RBAC handles this
      return true;
    },
    `User does not have permission for ${adjustmentType} adjustments`,
    'ADJUSTMENT_TYPE_PERMISSION_DENIED'
  );
}

/**
 * Condition: Stock must not be frozen
 * (Placeholder - implement when stock freeze feature is added)
 */
function stockNotFrozen(): any {
  return customCondition(
    'stock_not_frozen',
    'Stock must not be frozen',
    async (user: any, resource: any, context: any) => {
      // TODO: Implement stock freeze check when feature is added
      // For now, always allow
      return true;
    },
    'Stock is frozen and cannot be adjusted',
    'STOCK_FROZEN'
  );
}

/**
 * Condition: Warehouse must be accessible by user's branch
 */
function warehouseAccessibleByBranch(): any {
  return customCondition(
    'warehouse_accessible_by_branch',
    'Warehouse must be accessible by user\'s branch',
    async (user: any, resource: any, context: any) => {
      const warehouseId = resource.location_id || resource.warehouse_id || context.warehouseId;
      const branchId = resource.branch_id || context.branchId;

      if (!warehouseId || !branchId) {
        return true; // Cannot validate without both
      }

      try {
        const { isWarehouseAccessibleByBranch } = await import('../../warehouse-access');
        return await isWarehouseAccessibleByBranch(warehouseId, branchId);
      } catch (error) {
        console.error('Error checking warehouse-branch accessibility:', error);
        return false; // Fail secure
      }
    },
    'Warehouse is not accessible by your branch',
    'WAREHOUSE_BRANCH_MISMATCH'
  );
}

/**
 * Get all inventory adjustment policies
 */
export function getInventoryAdjustmentPolicies(): Policy[] {
  return [
    // READ policies
    {
      resource: 'inventory_adjustment',
      action: 'read',
      requiresPermission: 'items.read',
      priority: 10,
      conditions: [
        userHasWarehouseAccess(),
        resourceBelongsToBusiness(),
      ],
    },

    // CREATE QUANTITY ADJUSTMENT policies
    {
      resource: 'inventory_adjustment',
      action: 'adjust_quantity',
      requiresPermission: 'items.create', // Will be mapped to inventory.adjust.quantity in future
      priority: 10,
      conditions: [
        userHasWarehouseAccess(),
        warehouseAccessibleByBranch(),
        accountingPeriodIsOpen('adjustment_date'),
        stockNotFrozen(),
      ],
    },

    // CREATE VALUE ADJUSTMENT policies
    {
      resource: 'inventory_adjustment',
      action: 'adjust_value',
      requiresPermission: 'items.create', // Will be mapped to inventory.adjust.value in future
      priority: 10,
      conditions: [
        userHasWarehouseAccess(),
        warehouseAccessibleByBranch(),
        accountingPeriodIsOpen('adjustment_date'),
        stockNotFrozen(),
        // Value adjustments may require additional role checks (accountant vs operator)
        // This can be added as a custom condition when role-based restrictions are needed
      ],
    },

    // Generic CREATE policy (for backward compatibility)
    {
      resource: 'inventory_adjustment',
      action: 'create',
      requiresPermission: 'items.create',
      priority: 20, // Lower priority - more specific policies checked first
      conditions: [
        userHasWarehouseAccess(),
        resourceBelongsToBusiness(),
        warehouseAccessibleByBranch(),
        accountingPeriodIsOpen('adjustment_date'),
        stockNotFrozen(),
      ],
    },
  ];
}
