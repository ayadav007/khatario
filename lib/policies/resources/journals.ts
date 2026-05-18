/**
 * Journal Entry Policies
 * 
 * PBAC policies for journal entry operations.
 * These policies wrap RBAC and add business rule checks.
 * 
 * Key Rules:
 * - Period lock enforcement (global)
 * - Entry-level locking (is_locked prevents edit/delete)
 * - Branch alignment
 * - Business ownership
 */

import { Policy } from '../types';
import {
  userHasBranchAccess,
  accountingPeriodIsOpen,
  resourceBelongsToBusiness,
  resourceStatusIsNot,
  customCondition,
} from '../conditions';

/**
 * Condition: Journal entry is not locked (entry-level lock)
 */
function journalEntryNotLocked(): any {
  return customCondition(
    'journal_entry_not_locked',
    'Journal entry must not be locked',
    async (user: any, resource: any, context: any) => {
      const journal = resource;
      if (!journal) {
        return true; // Cannot validate without journal
      }
      // Check if journal entry is locked
      return journal.is_locked !== true;
    },
    'Journal entry is locked and cannot be modified',
    'JOURNAL_ENTRY_LOCKED'
  );
}

/**
 * Get all journal entry policies
 */
export function getJournalPolicies(): Policy[] {
  return [
    // READ policies
    {
      resource: 'journal',
      action: 'read',
      requiresPermission: 'settings.read', // Journal entries are part of accounting settings
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
      ],
    },

    // CREATE policies
    {
      resource: 'journal',
      action: 'create',
      requiresPermission: 'settings.create',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        // Branch access is checked in authorize() via context.branchId (RBAC level)
        accountingPeriodIsOpen('entry_date'),
      ],
    },

    // UPDATE policies
    {
      resource: 'journal',
      action: 'update',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
        journalEntryNotLocked(),
        accountingPeriodIsOpen('entry_date'),
      ],
    },

    // POST policies (special action - marking as finalized/posted)
    // Note: Current system uses is_locked instead of posted status
    // This policy can be used for future "post" functionality
    {
      resource: 'journal',
      action: 'post',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
        journalEntryNotLocked(),
        accountingPeriodIsOpen('entry_date'),
        // TODO: Add role check for accountants when role-based restrictions are needed
      ],
    },

    // DELETE policies
    {
      resource: 'journal',
      action: 'delete',
      requiresPermission: 'settings.delete',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
        journalEntryNotLocked(),
        accountingPeriodIsOpen('entry_date'),
      ],
    },

    // LOCK policies (entry-level locking)
    {
      resource: 'journal',
      action: 'lock',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
        journalEntryNotLocked(), // Can only lock unlocked entries
        accountingPeriodIsOpen('entry_date'), // Can only lock entries in open periods
      ],
    },

    // UNLOCK policies (entry-level unlocking)
    {
      resource: 'journal',
      action: 'unlock',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        userHasBranchAccess(),
        resourceBelongsToBusiness(),
        // Entry must be locked to unlock it
        customCondition(
          'journal_entry_is_locked',
          'Journal entry must be locked to unlock',
          async (user: any, resource: any, context: any) => {
            const journal = resource;
            if (!journal) {
              return false;
            }
            return journal.is_locked === true;
          },
          'Journal entry is not locked',
          'JOURNAL_ENTRY_NOT_LOCKED'
        ),
        accountingPeriodIsOpen('entry_date'),
      ],
    },
  ];
}
