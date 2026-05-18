/**
 * Accounting Period Policies Integration Tests
 * 
 * Tests for accounting period lock-specific PBAC policies
 */

import { getAccountingPeriodPolicies } from '../../lib/policies/resources/accounting-periods';
import { evaluatePolicy } from '../../lib/policies/engine';
import { PolicyUser, PolicyContext } from '../../lib/policies/types';

describe('Accounting Period Policies', () => {
  const mockUser: PolicyUser = {
    id: 'user-1',
    business_id: 'business-1',
    role_id: 'role-1',
    branch_ids: ['branch-1'],
    warehouse_ids: [],
  };

  describe('accounting_period.read policy', () => {
    it('should allow reading period lock from same business', async () => {
      const policies = getAccountingPeriodPolicies();
      const readPolicy = policies.find(p => p.action === 'read')!;

      const resource = {
        id: 'period-lock-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        period_start: '2024-01-01',
        period_end: '2024-01-31',
        is_locked: true,
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny reading period lock from different business', async () => {
      const policies = getAccountingPeriodPolicies();
      const readPolicy = policies.find(p => p.action === 'read')!;

      const resource = {
        id: 'period-lock-1',
        business_id: 'business-2', // Different business
        branch_id: 'branch-1',
        period_start: '2024-01-01',
        period_end: '2024-01-31',
        is_locked: true,
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('RESOURCE_BUSINESS_MISMATCH');
    });
  });

  describe('accounting_period.lock policy', () => {
    it('should allow locking period from same business', async () => {
      const policies = getAccountingPeriodPolicies();
      const lockPolicy = policies.find(p => p.action === 'lock')!;

      const resource = {
        business_id: 'business-1',
        branch_id: 'branch-1',
        period_start: '2024-01-01',
        period_end: '2024-01-31',
      };
      const context: PolicyContext = { 
        resource,
        period_start: '2024-01-01',
        period_end: '2024-01-31',
      };

      const result = await evaluatePolicy(lockPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny locking period with invalid date range', async () => {
      const policies = getAccountingPeriodPolicies();
      const lockPolicy = policies.find(p => p.action === 'lock')!;

      const resource = {
        business_id: 'business-1',
        branch_id: 'branch-1',
        period_start: '2024-01-31', // Start after end
        period_end: '2024-01-01',
      };
      const context: PolicyContext = { 
        resource,
        period_start: '2024-01-31',
        period_end: '2024-01-01',
      };

      const result = await evaluatePolicy(lockPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('INVALID_PERIOD_FOR_LOCKING');
    });

    it('should deny locking period from different business', async () => {
      const policies = getAccountingPeriodPolicies();
      const lockPolicy = policies.find(p => p.action === 'lock')!;

      const resource = {
        business_id: 'business-2', // Different business
        branch_id: 'branch-1',
        period_start: '2024-01-01',
        period_end: '2024-01-31',
      };
      const context: PolicyContext = { 
        resource,
        period_start: '2024-01-01',
        period_end: '2024-01-31',
      };

      const result = await evaluatePolicy(lockPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('RESOURCE_BUSINESS_MISMATCH');
    });
  });

  describe('accounting_period.unlock policy', () => {
    it('should allow unlocking locked period from same business', async () => {
      const policies = getAccountingPeriodPolicies();
      const unlockPolicy = policies.find(p => p.action === 'unlock')!;

      const resource = {
        id: 'period-lock-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        period_start: '2024-01-01',
        period_end: '2024-01-31',
        is_locked: true, // Locked
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(unlockPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny unlocking unlocked period', async () => {
      const policies = getAccountingPeriodPolicies();
      const unlockPolicy = policies.find(p => p.action === 'unlock')!;

      const resource = {
        id: 'period-lock-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        period_start: '2024-01-01',
        period_end: '2024-01-31',
        is_locked: false, // Not locked
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(unlockPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('INVALID_PERIOD_FOR_UNLOCKING');
    });

    it('should deny unlocking period from different business', async () => {
      const policies = getAccountingPeriodPolicies();
      const unlockPolicy = policies.find(p => p.action === 'unlock')!;

      const resource = {
        id: 'period-lock-1',
        business_id: 'business-2', // Different business
        branch_id: 'branch-1',
        period_start: '2024-01-01',
        period_end: '2024-01-31',
        is_locked: true,
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(unlockPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('RESOURCE_BUSINESS_MISMATCH');
    });
  });
});
