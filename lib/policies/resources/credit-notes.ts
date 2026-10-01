/**
 * Credit Note Policies
 * 
 * PBAC policies for credit note operations.
 */

import { Policy } from '../types';
import {
  userHasBranchAccess,
  resourceBelongsToBusiness,
  accountingPeriodIsOpen,
  resourceStatusIsNot,
} from '../conditions';

/**
 * Get all credit note policies
 */
export function getCreditNotePolicies(): Policy[] {
  return [
    // READ policies
    {
      resource: 'credit_notes',
      action: 'read',
      requiresPermission: 'credit_notes.read',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
      ],
    },

    // CREATE policies (if needed in future)
    {
      resource: 'credit_notes',
      action: 'create',
      requiresPermission: 'credit_notes.create',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        accountingPeriodIsOpen('credit_note_date'),
      ],
    },

    // CANCEL: posted credit notes are reversed, not deleted. Same permission shape as invoice cancel.
    {
      resource: 'credit_notes',
      action: 'cancel',
      requiresPermission: 'credit_notes.delete',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
        resourceStatusIsNot(['cancelled'], 'Credit note is already cancelled'),
        accountingPeriodIsOpen('credit_note_date'),
      ],
    },
  ];
}
