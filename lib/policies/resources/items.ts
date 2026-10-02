/**
 * Item Policies
 * 
 * PBAC policies for item/inventory operations.
 *
 * Items are business-wide (the items table has no branch_id), so these policies only
 * enforce the tenant boundary. Branch and warehouse limits apply to stock movements
 * (inventory_adjustment, warehouse_transfer), and authorize() still checks context.branchId.
 */

import { Policy } from '../types';
import { resourceBelongsToBusiness } from '../conditions';

/**
 * Get all item policies
 */
export function getItemPolicies(): Policy[] {
  return [
    {
      resource: 'items',
      action: 'read',
      requiresPermission: 'items.read',
      priority: 10,
      conditions: [resourceBelongsToBusiness()],
    },
    {
      resource: 'items',
      action: 'create',
      requiresPermission: 'items.create',
      priority: 10,
      conditions: [resourceBelongsToBusiness()],
    },
    {
      resource: 'items',
      action: 'update',
      requiresPermission: 'items.update',
      priority: 10,
      conditions: [resourceBelongsToBusiness()],
    },
    {
      resource: 'items',
      action: 'delete',
      requiresPermission: 'items.delete',
      priority: 10,
      conditions: [resourceBelongsToBusiness()],
    },
  ];
}
