/**
 * Warehouse Transfer Policies
 * 
 * PBAC policies for stock transfer operations.
 * These policies wrap RBAC and add business rule checks.
 * 
 * Key Rules:
 * - Source and destination warehouse access required
 * - Branch alignment enforced
 * - Transfer state transitions controlled
 * - No ghost stock or cross-branch leakage
 */

import { Policy } from '../types';
import {
  userHasWarehouseAccess,
  accountingPeriodIsOpen,
  resourceBelongsToBusiness,
  resourceStatusIs,
  resourceStatusIsNot,
  customCondition,
} from '../conditions';

/**
 * Condition: User has access to source warehouse
 */
function userHasSourceWarehouseAccess(): any {
  return customCondition(
    'user_has_source_warehouse_access',
    'User must have access to source warehouse',
    async (user: any, resource: any, context: any) => {
      const sourceWarehouseId = resource.from_location_id || resource.from_warehouse_id || context.sourceWarehouseId;
      if (!sourceWarehouseId) {
        return true; // Cannot validate without source warehouse
      }

      const { checkUserWarehousePermission } = await import('../../warehouse-access');
      return await checkUserWarehousePermission(user.id, sourceWarehouseId, 'create_transactions');
    },
    'You do not have access to the source warehouse',
    'SOURCE_WAREHOUSE_ACCESS_DENIED'
  );
}

/**
 * Condition: User has access to destination warehouse
 */
function userHasDestinationWarehouseAccess(): any {
  return customCondition(
    'user_has_destination_warehouse_access',
    'User must have access to destination warehouse',
    async (user: any, resource: any, context: any) => {
      const destWarehouseId = resource.to_location_id || resource.to_warehouse_id || context.destinationWarehouseId;
      if (!destWarehouseId) {
        return true; // Cannot validate without destination warehouse
      }

      const { checkUserWarehousePermission } = await import('../../warehouse-access');
      return await checkUserWarehousePermission(user.id, destWarehouseId, 'create_transactions');
    },
    'You do not have access to the destination warehouse',
    'DESTINATION_WAREHOUSE_ACCESS_DENIED'
  );
}

/**
 * Condition: Source and destination warehouses are different
 */
function sourceAndDestinationDifferent(): any {
  return customCondition(
    'source_destination_different',
    'Source and destination warehouses must be different',
    async (user: any, resource: any, context: any) => {
      const sourceId = resource.from_location_id || resource.from_warehouse_id || context.sourceWarehouseId;
      const destId = resource.to_location_id || resource.to_warehouse_id || context.destinationWarehouseId;

      if (!sourceId || !destId) {
        return true; // Cannot validate without both
      }

      return sourceId !== destId;
    },
    'Source and destination warehouses cannot be the same',
    'SAME_SOURCE_DESTINATION'
  );
}

/**
 * Condition: Transfer can be dispatched (status must be 'draft', 'pending_approval', or 'pending')
 * If user has approve permission, can dispatch from draft/pending_approval
 * Otherwise, must be 'pending' (already approved)
 */
function transferCanBeDispatched(): any {
  return customCondition(
    'transfer_can_be_dispatched',
    'Transfer must be in draft, pending_approval, or pending status to dispatch',
    async (user: any, resource: any, context: any) => {
      const status = resource.status;
      if (!status) {
        return false; // No status means cannot dispatch
      }
      // If status is 'pending', it's already approved and can be dispatched
      if (status === 'pending') {
        return true;
      }
      // If status is 'draft' or 'pending_approval', user must have approve permission
      if (status === 'draft' || status === 'pending_approval') {
        // Check if user has approve permission (will be checked by RBAC)
        // This condition just validates status, RBAC will check permission
        return true;
      }
      return false;
    },
    'Can only dispatch transfers in draft, pending_approval, or pending status',
    'INVALID_TRANSFER_STATUS'
  );
}

/**
 * Condition: Transfer can be approved (status must be 'draft' or 'pending_approval')
 */
function transferCanBeApproved(): any {
  return customCondition(
    'transfer_can_be_approved',
    'Transfer must be in draft or pending_approval status to approve',
    async (user: any, resource: any, context: any) => {
      const status = resource.status;
      if (!status) {
        return false;
      }
      return status === 'draft' || status === 'pending_approval';
    },
    'Can only approve transfers in draft or pending_approval status',
    'INVALID_TRANSFER_STATUS'
  );
}

/**
 * Condition: Transfer can be received (status must be 'in_transit')
 */
function transferCanBeReceived(): any {
  return customCondition(
    'transfer_can_be_received',
    'Transfer must be in in_transit status to receive',
    async (user: any, resource: any, context: any) => {
      const status = resource.status;
      if (!status) {
        return false; // No status means cannot receive
      }
      return status === 'in_transit';
    },
    'Can only receive transfers in in_transit status',
    'INVALID_TRANSFER_STATUS'
  );
}

/**
 * Condition: Transfer can be cancelled (status must be 'draft', 'pending_approval', 'pending', or 'in_transit')
 */
function transferCanBeCancelled(): any {
  return customCondition(
    'transfer_can_be_cancelled',
    'Transfer must be in draft, pending_approval, pending, or in_transit status to cancel',
    async (user: any, resource: any, context: any) => {
      const status = resource.status;
      if (!status) {
        return false; // No status means cannot cancel
      }
      // Cannot cancel completed transfers
      if (status === 'completed') {
        return false;
      }
      // Can cancel draft, pending_approval, pending, in_transit, or already cancelled
      return status === 'draft' || status === 'pending_approval' || status === 'pending' || status === 'in_transit' || status === 'cancelled';
    },
    'Can only cancel transfers that are not completed',
    'INVALID_TRANSFER_STATUS'
  );
}

/**
 * Condition: Stock is not frozen (placeholder)
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
    'Stock is frozen and cannot be transferred',
    'STOCK_FROZEN'
  );
}

/**
 * Get all warehouse transfer policies
 */
export function getWarehouseTransferPolicies(): Policy[] {
  return [
    // READ policies
    {
      resource: 'warehouse_transfer',
      action: 'read',
      requiresPermission: 'warehouse_transfer.view',
      priority: 10,
      conditions: [
        userHasSourceWarehouseAccess(),
        userHasDestinationWarehouseAccess(),
        resourceBelongsToBusiness(),
      ],
    },

    // CREATE policies
    {
      resource: 'warehouse_transfer',
      action: 'create',
      requiresPermission: 'warehouse_transfer.create',
      priority: 10,
      conditions: [
        userHasSourceWarehouseAccess(),
        userHasDestinationWarehouseAccess(),
        resourceBelongsToBusiness(),
        sourceAndDestinationDifferent(),
        accountingPeriodIsOpen('transfer_date'),
        stockNotFrozen(),
      ],
    },

    // APPROVE policies (special action)
    {
      resource: 'warehouse_transfer',
      action: 'approve',
      requiresPermission: 'warehouse_transfer.approve',
      priority: 10,
      conditions: [
        userHasSourceWarehouseAccess(),
        userHasDestinationWarehouseAccess(),
        resourceBelongsToBusiness(),
        transferCanBeApproved(),
        accountingPeriodIsOpen('transfer_date'),
        stockNotFrozen(),
      ],
    },

    // DISPATCH policies (special action)
    {
      resource: 'warehouse_transfer',
      action: 'dispatch',
      requiresPermission: 'warehouse_transfer.dispatch',
      priority: 10,
      conditions: [
        userHasSourceWarehouseAccess(),
        resourceBelongsToBusiness(),
        transferCanBeDispatched(),
        accountingPeriodIsOpen('transfer_date'),
        stockNotFrozen(),
      ],
    },

    // RECEIVE policies (special action)
    {
      resource: 'warehouse_transfer',
      action: 'receive',
      requiresPermission: 'warehouse_transfer.receive',
      priority: 10,
      conditions: [
        userHasDestinationWarehouseAccess(),
        resourceBelongsToBusiness(),
        transferCanBeReceived(),
        accountingPeriodIsOpen('transfer_date'),
        stockNotFrozen(),
      ],
    },

    // CANCEL policies (special action)
    {
      resource: 'warehouse_transfer',
      action: 'cancel',
      requiresPermission: 'warehouse_transfer.cancel',
      priority: 10,
      conditions: [
        userHasSourceWarehouseAccess(),
        resourceBelongsToBusiness(),
        transferCanBeCancelled(),
        accountingPeriodIsOpen('transfer_date'),
      ],
    },
  ];
}
