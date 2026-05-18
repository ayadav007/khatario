/**
 * Work Orders Policies
 * 
 * PBAC policies for work order operations.
 * Work orders are service/job tracking documents similar to invoices.
 */

import { Policy } from '../types';
import {
  userHasBranchAccess,
  resourceStatusIs,
  resourceStatusIsNot,
  accountingPeriodIsOpen,
  resourceBelongsToBusiness,
} from '../conditions';

/**
 * Get all work order policies
 */
export function getWorkOrderPolicies(): Policy[] {
  return [
    // READ policies
    {
      resource: 'work_orders',
      action: 'read',
      requiresPermission: 'work_orders.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },

    // CREATE policies
    {
      resource: 'work_orders',
      action: 'create',
      requiresPermission: 'work_orders.create',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        // Work orders are business-scoped (not branch-scoped)
        // Period lock check (if applicable)
        accountingPeriodIsOpen('work_order_date'),
      ],
    },

    // UPDATE policies
    {
      resource: 'work_orders',
      action: 'update',
      requiresPermission: 'work_orders.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        // Allow update unless completed or cancelled
        resourceStatusIsNot(['completed', 'cancelled'], 'Cannot update completed or cancelled work orders'),
        accountingPeriodIsOpen('work_order_date'),
      ],
    },

    // DELETE policies
    {
      resource: 'work_orders',
      action: 'delete',
      requiresPermission: 'work_orders.delete',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        // Allow delete unless completed or cancelled
        resourceStatusIsNot(['completed', 'cancelled'], 'Cannot delete completed or cancelled work orders'),
        accountingPeriodIsOpen('work_order_date'),
      ],
    },
  ];
}
