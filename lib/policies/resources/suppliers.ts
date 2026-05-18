/**
 * Supplier Policies
 * 
 * PBAC policies for supplier operations.
 */

import { Policy } from '../types';
import {
  userHasBranchAccess,
  resourceBelongsToBusiness,
} from '../conditions';

/**
 * Get all supplier policies
 */
export function getSupplierPolicies(): Policy[] {
  return [
    // READ policies
    {
      resource: 'suppliers',
      action: 'read',
      requiresPermission: 'suppliers.read',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
      ],
    },

    // CREATE policies
    {
      resource: 'suppliers',
      action: 'create',
      requiresPermission: 'suppliers.create',
      priority: 10,
      conditions: [
        // Branch access is checked in authorize() via context.branchId (RBAC level)
        resourceBelongsToBusiness(),
      ],
    },

    // UPDATE policies
    {
      resource: 'suppliers',
      action: 'update',
      requiresPermission: 'suppliers.update',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
      ],
    },

    // DELETE policies
    {
      resource: 'suppliers',
      action: 'delete',
      requiresPermission: 'suppliers.delete',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
      ],
    },
  ];
}
