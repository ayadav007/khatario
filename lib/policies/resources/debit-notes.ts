/**
 * Debit notes are cancelled by reversal, the same shape as credit notes.
 * Create and read stay on the existing permission path.
 */

import { Policy } from '../types';
import {
  userHasBranchAccess,
  resourceBelongsToBusiness,
  accountingPeriodIsOpen,
  resourceStatusIsNot,
} from '../conditions';

export function getDebitNotePolicies(): Policy[] {
  return [
    {
      resource: 'debit_notes',
      action: 'cancel',
      requiresPermission: 'debit_notes.delete',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
        resourceStatusIsNot(['cancelled'], 'Debit note is already cancelled'),
        accountingPeriodIsOpen('debit_note_date'),
      ],
    },
  ];
}
