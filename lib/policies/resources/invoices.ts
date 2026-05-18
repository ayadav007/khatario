/**
 * Invoice Policies
 * 
 * PBAC policies for invoice operations.
 * These policies wrap RBAC and add business rule checks.
 */

import { Policy } from '../types';
import {
  userHasBranchAccess,
  resourceStatusIs,
  resourceStatusIsNot,
  accountingPeriodIsOpen,
  resourceBelongsToBusiness,
  customCondition,
} from '../conditions';

/**
 * Get all invoice policies
 */
export function getInvoicePolicies(): Policy[] {
  return [
    // READ policies
    {
      resource: 'invoices',
      action: 'read',
      requiresPermission: 'invoices.read',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
      ],
    },

    // CREATE policies
    {
      resource: 'invoices',
      action: 'create',
      requiresPermission: 'invoices.create',
      priority: 10,
      conditions: [
        // Branch access is checked in authorize() via context.branchId (RBAC level)
        // Period lock check
        accountingPeriodIsOpen('invoice_date'),
      ],
    },

    // UPDATE policies
    {
      resource: 'invoices',
      action: 'update',
      requiresPermission: 'invoices.update',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
        // Allow updates to proforma invoices even if finalized (for estimate_status updates)
        // For regular invoices, block updates if finalized or cancelled
        customCondition(
          'invoice_status_check',
          'Invoice status must allow updates',
          async (user, resource, context) => {
            // For proforma invoices, allow updates even if status is 'final' or 'cancelled'
            // because estimate_status is separate from invoice status
            if (resource.document_type === 'proforma_invoice') {
              return true; // Allow updates to proforma invoices regardless of status
            }
            // For regular invoices, check status
            const status = resource.status;
            if (!status) {
              return true; // No status means not finalized
            }
            return !['final', 'cancelled'].includes(status);
          },
          'Cannot update finalized or cancelled invoices',
          'INVALID_RESOURCE_STATUS'
        ),
        accountingPeriodIsOpen('invoice_date'),
      ],
    },

    // DELETE policies
    {
      resource: 'invoices',
      action: 'delete',
      requiresPermission: 'invoices.delete',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
        resourceStatusIsNot(['final', 'cancelled'], 'Cannot delete finalized or cancelled invoices'),
        accountingPeriodIsOpen('invoice_date'),
      ],
    },

    // FINALIZE policies (special action)
    {
      resource: 'invoices',
      action: 'finalize',
      requiresPermission: 'invoices.update',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
        resourceStatusIs(['draft'], 'Can only finalize draft invoices'),
        accountingPeriodIsOpen('invoice_date'),
      ],
    },

    // CANCEL policies (special action)
    {
      resource: 'invoices',
      action: 'cancel',
      requiresPermission: 'invoices.delete',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
        resourceStatusIsNot(['cancelled'], 'Invoice is already cancelled'),
        accountingPeriodIsOpen('invoice_date'),
      ],
    },
  ];
}
