/**
 * Report Policies
 * 
 * PBAC policies for report operations.
 * These policies wrap RBAC and add business rule checks.
 * 
 * Key Rules:
 * - Branch scope enforcement (when branch_id provided)
 * - Warehouse scope enforcement (when warehouse_id provided)
 * - Export requires elevated permissions
 * - Financial reports may require accounting access
 * - Period locks don't block read, but may affect visibility
 */

import { Policy } from '../types';
import {
  userHasBranchAccess,
  userHasWarehouseAccess,
  resourceBelongsToBusiness,
  customCondition,
} from '../conditions';

/**
 * Condition: User has access to requested branch(es) for reports
 */
function userHasReportBranchAccess(): any {
  return customCondition(
    'user_has_report_branch_access',
    'User must have access to requested branch for report',
    async (user: any, resource: any, context: any) => {
      const branchId = resource.branch_id || context.branchId;
      
      // If no branch specified, allow (all branches report)
      if (!branchId) {
        return true;
      }

      // Check if user has access to this branch
      const { checkUserBranchPermission } = await import('../../branch-access');
      return await checkUserBranchPermission(user.id, branchId, 'view');
    },
    'You do not have access to the requested branch',
    'BRANCH_ACCESS_DENIED'
  );
}

/**
 * Condition: User has access to requested warehouse(s) for reports
 */
function userHasReportWarehouseAccess(): any {
  return customCondition(
    'user_has_report_warehouse_access',
    'User must have access to requested warehouse for report',
    async (user: any, resource: any, context: any) => {
      const warehouseId = resource.warehouse_id || context.warehouseId;
      
      // If no warehouse specified, allow (all warehouses report)
      if (!warehouseId) {
        return true;
      }

      // Check if user has access to this warehouse
      const { checkUserWarehousePermission } = await import('../../warehouse-access');
      return await checkUserWarehousePermission(user.id, warehouseId, 'view');
    },
    'You do not have access to the requested warehouse',
    'WAREHOUSE_ACCESS_DENIED'
  );
}

/**
 * Condition: Financial reports require accounting access
 * Placeholder for future role-based restrictions
 */
function userHasAccountingAccess(): any {
  return customCondition(
    'user_has_accounting_access',
    'User must have accounting access for financial reports',
    async (user: any, resource: any, context: any) => {
      // TODO: Add role-based check when role system is enhanced
      // For now, check if user has reports.read permission (checked at RBAC level)
      return true;
    },
    'You do not have permission to view financial reports',
    'ACCOUNTING_ACCESS_DENIED'
  );
}

/**
 * Get all report policies
 */
export function getReportPolicies(): Policy[] {
  return [
    // READ policies - Basic reports
    {
      resource: 'report',
      action: 'read',
      requiresPermission: 'reports.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        userHasReportBranchAccess(),
        userHasReportWarehouseAccess(),
      ],
    },

    // READ policies - Financial reports (advanced)
    {
      resource: 'report.financial',
      action: 'read',
      requiresPermission: 'reports.read',
      priority: 5, // Higher priority than generic report.read
      conditions: [
        resourceBelongsToBusiness(),
        userHasReportBranchAccess(),
        userHasAccountingAccess(),
      ],
    },

    // READ policies - Inventory reports
    {
      resource: 'report.inventory',
      action: 'read',
      requiresPermission: 'reports.read',
      priority: 5,
      conditions: [
        resourceBelongsToBusiness(),
        userHasReportBranchAccess(),
        userHasReportWarehouseAccess(),
      ],
    },

    // READ policies - GST reports
    {
      resource: 'report.gst',
      action: 'read',
      requiresPermission: 'reports.read',
      priority: 5,
      conditions: [
        resourceBelongsToBusiness(),
        userHasReportBranchAccess(),
      ],
    },

    // EXPORT policies - Basic reports
    {
      resource: 'report',
      action: 'export',
      requiresPermission: 'reports.export',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        userHasReportBranchAccess(),
        userHasReportWarehouseAccess(),
      ],
    },

    // EXPORT policies - Financial reports
    {
      resource: 'report.financial',
      action: 'export',
      requiresPermission: 'reports.export',
      priority: 5,
      conditions: [
        resourceBelongsToBusiness(),
        userHasReportBranchAccess(),
        userHasAccountingAccess(),
      ],
    },

    // EXPORT policies - GST reports
    {
      resource: 'report.gst',
      action: 'export',
      requiresPermission: 'reports.export',
      priority: 5,
      conditions: [
        resourceBelongsToBusiness(),
        userHasReportBranchAccess(),
      ],
    },
  ];
}
