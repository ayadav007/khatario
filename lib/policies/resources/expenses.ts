/**
 * Expense Policies
 * 
 * PBAC policies for expense operations.
 */

import { Policy } from '../types';
import {
  userHasBranchAccess,
  resourceBelongsToBusiness,
  accountingPeriodIsOpen,
} from '../conditions';

/**
 * Get all expense policies
 */
export function getExpensePolicies(): Policy[] {
  return [
    // READ policies
    {
      resource: 'expenses',
      action: 'read',
      requiresPermission: 'expenses.read',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
      ],
    },

    // CREATE policies
    {
      resource: 'expenses',
      action: 'create',
      requiresPermission: 'expenses.create',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        // Branch access is checked in authorize() via context.branchId (RBAC level)
        accountingPeriodIsOpen('expense_date'),
      ],
    },
  ];
}
