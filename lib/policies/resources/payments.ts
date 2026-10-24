/**
 * Payment Policies
 * 
 * PBAC policies for payment operations.
 */

import { Policy } from '../types';
import {
  userHasBranchAccess,
  resourceBelongsToBusiness,
  accountingPeriodIsOpen,
} from '../conditions';

/**
 * Get all payment policies
 */
export function getPaymentPolicies(): Policy[] {
  return [
    // READ policies
    {
      resource: 'payments',
      action: 'read',
      requiresPermission: 'payments.read',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
      ],
    },

    // CREATE policies
    {
      resource: 'payments',
      action: 'create',
      requiresPermission: 'payments.create',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        // Branch access is checked in authorize() via context.branchId (RBAC level)
        accountingPeriodIsOpen('payment_date'),
      ],
    },

    // REVERSE: the payments:reverse permission is the Create flag of the payment_reversals
    // RBAC module. Period locks are checked by the route against the reversal date.
    {
      resource: 'payment_reversals',
      action: 'create',
      requiresPermission: 'payment_reversals.create',
      priority: 10,
      conditions: [resourceBelongsToBusiness()],
    },
  ];
}
