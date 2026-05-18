/**
 * Accounting Period Policies
 * 
 * PBAC policies for period lock operations.
 * These policies wrap RBAC and add business rule checks.
 * 
 * Key Rules:
 * - Only authorized roles can lock/unlock periods
 * - Cannot unlock periods with dependent closed periods
 * - Period locks affect all transactions globally
 */

import { Policy } from '../types';
import {
  resourceBelongsToBusiness,
  customCondition,
} from '../conditions';

/**
 * Condition: User has permission to lock/unlock periods
 * Typically requires accountant or admin role
 */
function userCanManagePeriodLocks(): any {
  return customCondition(
    'user_can_manage_period_locks',
    'User must have permission to manage period locks',
    async (user: any, resource: any, context: any) => {
      // TODO: Add role-based check when role system is enhanced
      // For now, check if user has settings.update permission (checked at RBAC level)
      // This condition is a placeholder for future role-based restrictions
      return true;
    },
    'You do not have permission to manage period locks',
    'PERIOD_LOCK_PERMISSION_DENIED'
  );
}

/**
 * Condition: Period can be locked (validation rules)
 */
function periodCanBeLocked(): any {
  return customCondition(
    'period_can_be_locked',
    'Period must meet requirements to be locked',
    async (user: any, resource: any, context: any) => {
      const periodStart = resource.period_start || context.period_start;
      const periodEnd = resource.period_end || context.period_end;

      if (!periodStart || !periodEnd) {
        return true; // Cannot validate without dates
      }

      const startDate = new Date(periodStart);
      const endDate = new Date(periodEnd);

      // Period start must be before or equal to period end
      if (startDate > endDate) {
        return false;
      }

      // Typically, only past periods can be locked (future periods should remain open)
      // This is a business rule that can be adjusted
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Allow locking if end date is today or in the past
      // Allow future periods for testing/advance planning (optional restriction)
      // For now, allow any period to be locked
      return true;
    },
    'Period cannot be locked. Period end date must be in the past.',
    'INVALID_PERIOD_FOR_LOCKING'
  );
}

/**
 * Condition: Period can be unlocked (validation rules)
 */
function periodCanBeUnlocked(): any {
  return customCondition(
    'period_can_be_unlocked',
    'Period must meet requirements to be unlocked',
    async (user: any, resource: any, context: any) => {
      // TODO: Add check for dependent closed periods
      // If a later period is locked, earlier periods cannot be unlocked
      // This prevents breaking audit chains
      
      // For now, allow unlocking if period exists and is locked
      const isLocked = resource.is_locked;
      return isLocked === true;
    },
    'Period cannot be unlocked. Period may have dependent closed periods or is not locked.',
    'INVALID_PERIOD_FOR_UNLOCKING'
  );
}

/**
 * Get all accounting period policies
 */
export function getAccountingPeriodPolicies(): Policy[] {
  return [
    // READ policies
    {
      resource: 'accounting_period',
      action: 'read',
      requiresPermission: 'settings.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },

    // LOCK policies
    {
      resource: 'accounting_period',
      action: 'lock',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        userCanManagePeriodLocks(),
        periodCanBeLocked(),
      ],
    },

    // UNLOCK policies
    {
      resource: 'accounting_period',
      action: 'unlock',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        userCanManagePeriodLocks(),
        periodCanBeUnlocked(),
      ],
    },
  ];
}
