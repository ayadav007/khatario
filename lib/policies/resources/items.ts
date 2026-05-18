/**
 * Item Policies
 * 
 * PBAC policies for item/inventory operations.
 */

import { Policy } from '../types';
import {
  userHasBranchAccess,
  userHasWarehouseAccess,
  resourceBelongsToBusiness,
} from '../conditions';

/**
 * Get all item policies
 */
export function getItemPolicies(): Policy[] {
  return [
    // READ policies
    {
      resource: 'items',
      action: 'read',
      requiresPermission: 'items.read',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
      ],
    },

    // CREATE policies
    {
      resource: 'items',
      action: 'create',
      requiresPermission: 'items.create',
      priority: 10,
      conditions: [
        // Branch access is checked in authorize() via context.branchId (RBAC level)
        resourceBelongsToBusiness(),
      ],
    },

    // UPDATE policies
    {
      resource: 'items',
      action: 'update',
      requiresPermission: 'items.update',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
      ],
    },

    // DELETE policies
    {
      resource: 'items',
      action: 'delete',
      requiresPermission: 'items.delete',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
      ],
    },
  ];
}
