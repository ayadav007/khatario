/**
 * Purchase Policies
 * 
 * PBAC policies for purchase operations.
 */

import { Policy } from '../types';
import {
  userHasBranchAccess,
  resourceBelongsToBusiness,
  accountingPeriodIsOpen,
} from '../conditions';

/**
 * Get all purchase policies
 */
export function getPurchasePolicies(): Policy[] {
  return [
    // READ policies
    {
      resource: 'purchases',
      action: 'read',
      requiresPermission: 'purchases.read',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
      ],
    },

    // CREATE policies
    {
      resource: 'purchases',
      action: 'create',
      requiresPermission: 'purchases.create',
      priority: 10,
      conditions: [
        // Branch access is checked in authorize() via context.branchId (RBAC level)
        accountingPeriodIsOpen('bill_date'),
      ],
    },

    // UPDATE policies
    {
      resource: 'purchases',
      action: 'update',
      requiresPermission: 'purchases.update',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
        accountingPeriodIsOpen('bill_date'),
      ],
    },

    // DELETE policies
    {
      resource: 'purchases',
      action: 'delete',
      requiresPermission: 'purchases.delete',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
      ],
    },
  ];
}
