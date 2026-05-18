/**
 * Customer Policies
 * 
 * PBAC policies for customer operations.
 */

import { Policy } from '../types';
import {
  userHasBranchAccess,
  resourceBelongsToBusiness,
} from '../conditions';

/**
 * Get all customer policies
 */
export function getCustomerPolicies(): Policy[] {
  return [
    // READ policies
    {
      resource: 'customers',
      action: 'read',
      requiresPermission: 'customers.read',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
      ],
    },

    // CREATE policies
    {
      resource: 'customers',
      action: 'create',
      requiresPermission: 'customers.create',
      priority: 10,
      conditions: [
        // Branch access is checked in authorize() via context.branchId (RBAC level)
        resourceBelongsToBusiness(),
      ],
    },

    // UPDATE policies
    {
      resource: 'customers',
      action: 'update',
      requiresPermission: 'customers.update',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
      ],
    },
  ];
}
