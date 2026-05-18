/**
 * Journal Policies Integration Tests
 * 
 * Tests for journal entry-specific PBAC policies
 */

import { getJournalPolicies } from '../../lib/policies/resources/journals';
import { evaluatePolicy } from '../../lib/policies/engine';
import { PolicyUser, PolicyContext } from '../../lib/policies/types';

// Mock dependencies
jest.mock('../../lib/branch-access', () => ({
  checkUserBranchPermission: jest.fn(),
}));

jest.mock('../../lib/period-lock-utils', () => ({
  isPeriodLocked: jest.fn(),
}));

describe('Journal Policies', () => {
  const mockUser: PolicyUser = {
    id: 'user-1',
    business_id: 'business-1',
    role_id: 'role-1',
    branch_ids: ['branch-1'],
    warehouse_ids: [],
  };

  const { checkUserBranchPermission } = require('../../lib/branch-access');
  const { isPeriodLocked } = require('../../lib/period-lock-utils');

  beforeEach(() => {
    jest.clearAllMocks();
    checkUserBranchPermission.mockResolvedValue(true);
    isPeriodLocked.mockResolvedValue(false);
  });

  describe('journal.read policy', () => {
    it('should allow reading journal entry from accessible branch', async () => {
      const policies = getJournalPolicies();
      const readPolicy = policies.find(p => p.action === 'read')!;

      const resource = {
        id: 'journal-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        entry_date: '2024-01-15',
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
      expect(checkUserBranchPermission).toHaveBeenCalledWith('user-1', 'branch-1', 'view');
    });

    it('should deny reading journal entry from inaccessible branch', async () => {
      checkUserBranchPermission.mockResolvedValue(false);

      const policies = getJournalPolicies();
      const readPolicy = policies.find(p => p.action === 'read')!;

      const resource = {
        id: 'journal-1',
        business_id: 'business-1',
        branch_id: 'branch-2', // Different branch
        entry_date: '2024-01-15',
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('BRANCH_ACCESS_DENIED');
    });

    it('should deny reading journal entry from different business', async () => {
      const policies = getJournalPolicies();
      const readPolicy = policies.find(p => p.action === 'read')!;

      const resource = {
        id: 'journal-1',
        business_id: 'business-2', // Different business
        branch_id: 'branch-1',
        entry_date: '2024-01-15',
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('RESOURCE_BUSINESS_MISMATCH');
    });
  });

  describe('journal.create policy', () => {
    it('should allow creating journal entry in open period', async () => {
      const policies = getJournalPolicies();
      const createPolicy = policies.find(p => p.action === 'create')!;

      const resource = {
        business_id: 'business-1',
        entry_date: '2024-01-15',
      };
      const context: PolicyContext = { 
        resource,
        entry_date: '2024-01-15',
        businessId: 'business-1',
      };

      const result = await evaluatePolicy(createPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
      expect(isPeriodLocked).toHaveBeenCalled();
    });

    it('should deny creating journal entry in locked period', async () => {
      isPeriodLocked.mockResolvedValue(true);

      const policies = getJournalPolicies();
      const createPolicy = policies.find(p => p.action === 'create')!;

      const resource = {
        business_id: 'business-1',
        entry_date: '2024-01-15',
      };
      const context: PolicyContext = { 
        resource,
        entry_date: '2024-01-15',
        businessId: 'business-1',
      };

      const result = await evaluatePolicy(createPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('PERIOD_LOCKED');
    });
  });

  describe('journal.update policy', () => {
    it('should allow updating unlocked journal entry in open period', async () => {
      const policies = getJournalPolicies();
      const updatePolicy = policies.find(p => p.action === 'update')!;

      const resource = {
        id: 'journal-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        entry_date: '2024-01-15',
        is_locked: false,
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(updatePolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny updating locked journal entry', async () => {
      const policies = getJournalPolicies();
      const updatePolicy = policies.find(p => p.action === 'update')!;

      const resource = {
        id: 'journal-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        entry_date: '2024-01-15',
        is_locked: true, // Locked
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(updatePolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('JOURNAL_ENTRY_LOCKED');
    });

    it('should deny updating journal entry in locked period', async () => {
      isPeriodLocked.mockResolvedValue(true);

      const policies = getJournalPolicies();
      const updatePolicy = policies.find(p => p.action === 'update')!;

      const resource = {
        id: 'journal-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        entry_date: '2024-01-15',
        is_locked: false,
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(updatePolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('PERIOD_LOCKED');
    });
  });

  describe('journal.delete policy', () => {
    it('should allow deleting unlocked journal entry in open period', async () => {
      const policies = getJournalPolicies();
      const deletePolicy = policies.find(p => p.action === 'delete')!;

      const resource = {
        id: 'journal-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        entry_date: '2024-01-15',
        is_locked: false,
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(deletePolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny deleting locked journal entry', async () => {
      const policies = getJournalPolicies();
      const deletePolicy = policies.find(p => p.action === 'delete')!;

      const resource = {
        id: 'journal-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        entry_date: '2024-01-15',
        is_locked: true, // Locked
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(deletePolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('JOURNAL_ENTRY_LOCKED');
    });
  });

  describe('journal.lock policy', () => {
    it('should allow locking unlocked journal entry in open period', async () => {
      const policies = getJournalPolicies();
      const lockPolicy = policies.find(p => p.action === 'lock')!;

      const resource = {
        id: 'journal-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        entry_date: '2024-01-15',
        is_locked: false, // Not locked
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(lockPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny locking already locked journal entry', async () => {
      const policies = getJournalPolicies();
      const lockPolicy = policies.find(p => p.action === 'lock')!;

      const resource = {
        id: 'journal-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        entry_date: '2024-01-15',
        is_locked: true, // Already locked
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(lockPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('JOURNAL_ENTRY_LOCKED');
    });
  });

  describe('journal.unlock policy', () => {
    it('should allow unlocking locked journal entry in open period', async () => {
      const policies = getJournalPolicies();
      const unlockPolicy = policies.find(p => p.action === 'unlock')!;

      const resource = {
        id: 'journal-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        entry_date: '2024-01-15',
        is_locked: true, // Locked
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(unlockPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny unlocking unlocked journal entry', async () => {
      const policies = getJournalPolicies();
      const unlockPolicy = policies.find(p => p.action === 'unlock')!;

      const resource = {
        id: 'journal-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        entry_date: '2024-01-15',
        is_locked: false, // Not locked
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(unlockPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('JOURNAL_ENTRY_NOT_LOCKED');
    });
  });
});
