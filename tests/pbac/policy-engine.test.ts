/**
 * PBAC Policy Engine Tests
 * 
 * Tests for policy evaluation engine
 */

import { evaluatePolicy } from '../../lib/policies/engine';
import { Policy, PolicyUser, PolicyContext } from '../../lib/policies/types';
import { resourceStatusIs, resourceStatusIsNot, accountingPeriodIsOpen } from '../../lib/policies/conditions';

// Mock period lock utils
jest.mock('../../lib/period-lock-utils', () => ({
  isPeriodLocked: jest.fn(),
}));

// Mock branch access
jest.mock('../../lib/branch-access', () => ({
  checkUserBranchPermission: jest.fn(),
}));

describe('Policy Engine', () => {
  const mockUser: PolicyUser = {
    id: 'user-1',
    business_id: 'business-1',
    role_id: 'role-1',
    branch_ids: ['branch-1'],
    warehouse_ids: ['warehouse-1'],
  };

  describe('evaluatePolicy', () => {
    it('should allow access when all conditions pass', async () => {
      const policy: Policy = {
        resource: 'invoice',
        action: 'update',
        requiresPermission: 'invoices.update',
        conditions: [
          resourceStatusIsNot(['final', 'cancelled']),
        ],
      };

      const resource = { status: 'draft' };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(policy, mockUser, context);

      expect(result.allowed).toBe(true);
      expect(result.failedCondition).toBeUndefined();
    });

    it('should deny access when a condition fails', async () => {
      const policy: Policy = {
        resource: 'invoice',
        action: 'update',
        requiresPermission: 'invoices.update',
        conditions: [
          resourceStatusIsNot(['final', 'cancelled'], 'Cannot update finalized invoices'),
        ],
      };

      const resource = { status: 'final' };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(policy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.failedCondition).toBeDefined();
      expect(result.errorMessage).toBe('Cannot update finalized invoices');
      expect(result.errorCode).toBe('INVALID_RESOURCE_STATUS');
    });

    it('should allow access when no conditions are defined', async () => {
      const policy: Policy = {
        resource: 'invoice',
        action: 'read',
        requiresPermission: 'invoices.read',
        conditions: [],
      };

      const context: PolicyContext = {};

      const result = await evaluatePolicy(policy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should handle condition evaluation errors gracefully', async () => {
      const failingCondition = {
        id: 'failing_condition',
        description: 'A condition that throws an error',
        errorMessage: 'Condition failed',
        errorCode: 'CONDITION_ERROR',
        evaluate: async () => {
          throw new Error('Unexpected error');
        },
      };

      const policy: Policy = {
        resource: 'invoice',
        action: 'update',
        requiresPermission: 'invoices.update',
        conditions: [failingCondition],
      };

      const context: PolicyContext = {};

      const result = await evaluatePolicy(policy, mockUser, context);

      expect(result.allowed).toBe(false);
      // Error message may contain condition ID or generic message
      expect(result.errorMessage).toBeDefined();
      // Condition has its own errorCode, so it should use that
      expect(result.errorCode).toBe('CONDITION_ERROR');
    });
  });

  describe('Status-based conditions', () => {
    it('should allow when status matches allowed statuses', async () => {
      const policy: Policy = {
        resource: 'invoice',
        action: 'finalize',
        requiresPermission: 'invoices.update',
        conditions: [
          resourceStatusIs(['draft'], 'Can only finalize draft invoices'),
        ],
      };

      const resource = { status: 'draft' };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(policy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny when status does not match allowed statuses', async () => {
      const policy: Policy = {
        resource: 'invoice',
        action: 'finalize',
        requiresPermission: 'invoices.update',
        conditions: [
          resourceStatusIs(['draft'], 'Can only finalize draft invoices'),
        ],
      };

      const resource = { status: 'final' };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(policy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorMessage).toBe('Can only finalize draft invoices');
    });

    it('should deny when status is in disallowed list', async () => {
      const policy: Policy = {
        resource: 'invoice',
        action: 'update',
        requiresPermission: 'invoices.update',
        conditions: [
          resourceStatusIsNot(['final', 'cancelled'], 'Cannot update finalized or cancelled invoices'),
        ],
      };

      const resource = { status: 'cancelled' };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(policy, mockUser, context);

      expect(result.allowed).toBe(false);
    });
  });

  describe('Period lock conditions', () => {
    const { isPeriodLocked } = require('../../lib/period-lock-utils');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should allow when period is not locked', async () => {
      isPeriodLocked.mockResolvedValue(false);

      const policy: Policy = {
        resource: 'invoice',
        action: 'update',
        requiresPermission: 'invoices.update',
        conditions: [
          accountingPeriodIsOpen('invoice_date'),
        ],
      };

      const resource = {
        invoice_date: '2024-01-15',
        business_id: 'business-1',
        branch_id: 'branch-1',
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(policy, mockUser, context);

      expect(result.allowed).toBe(true);
      expect(isPeriodLocked).toHaveBeenCalledWith('business-1', 'branch-1', '2024-01-15');
    });

    it('should deny when period is locked', async () => {
      isPeriodLocked.mockResolvedValue(true);

      const policy: Policy = {
        resource: 'invoice',
        action: 'update',
        requiresPermission: 'invoices.update',
        conditions: [
          accountingPeriodIsOpen('invoice_date'),
        ],
      };

      const resource = {
        invoice_date: '2024-01-15',
        business_id: 'business-1',
        branch_id: 'branch-1',
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(policy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('PERIOD_LOCKED');
      expect(result.errorMessage).toBe('Cannot modify entries in a locked accounting period');
    });

    it('should allow when date is not provided (will be validated elsewhere)', async () => {
      const policy: Policy = {
        resource: 'invoice',
        action: 'create',
        requiresPermission: 'invoices.create',
        conditions: [
          accountingPeriodIsOpen('invoice_date'),
        ],
      };

      const context: PolicyContext = {};

      const result = await evaluatePolicy(policy, mockUser, context);

      expect(result.allowed).toBe(true);
      expect(isPeriodLocked).not.toHaveBeenCalled();
    });
  });
});
