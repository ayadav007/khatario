/**
 * Invoice Policies Integration Tests
 * 
 * Tests for invoice-specific PBAC policies
 */

import { getInvoicePolicies } from '../../lib/policies/resources/invoices';
import { evaluatePolicy } from '../../lib/policies/engine';
import { PolicyUser, PolicyContext } from '../../lib/policies/types';

// Mock dependencies
jest.mock('../../lib/period-lock-utils', () => ({
  isPeriodLocked: jest.fn(),
}));

jest.mock('../../lib/branch-access', () => ({
  checkUserBranchPermission: jest.fn(),
}));

describe('Invoice Policies', () => {
  const mockUser: PolicyUser = {
    id: 'user-1',
    business_id: 'business-1',
    role_id: 'role-1',
    branch_ids: ['branch-1'],
    warehouse_ids: ['warehouse-1'],
  };

  const { isPeriodLocked } = require('../../lib/period-lock-utils');
  const { checkUserBranchPermission } = require('../../lib/branch-access');

  beforeEach(() => {
    jest.clearAllMocks();
    isPeriodLocked.mockResolvedValue(false);
    checkUserBranchPermission.mockResolvedValue(true);
  });

  describe('invoice.read policy', () => {
    it('should allow reading invoice from accessible branch', async () => {
      const policies = getInvoicePolicies();
      const readPolicy = policies.find(p => p.action === 'read')!;

      const resource = {
        id: 'invoice-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        status: 'final',
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
      expect(checkUserBranchPermission).toHaveBeenCalledWith('user-1', 'branch-1', 'view');
    });

    it('should deny reading invoice from inaccessible branch', async () => {
      checkUserBranchPermission.mockResolvedValue(false);

      const policies = getInvoicePolicies();
      const readPolicy = policies.find(p => p.action === 'read')!;

      const resource = {
        id: 'invoice-1',
        business_id: 'business-1',
        branch_id: 'branch-2', // Different branch
        status: 'final',
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('BRANCH_ACCESS_DENIED');
    });

    it('should deny reading invoice from different business', async () => {
      const policies = getInvoicePolicies();
      const readPolicy = policies.find(p => p.action === 'read')!;

      const resource = {
        id: 'invoice-1',
        business_id: 'business-2', // Different business
        branch_id: 'branch-1',
        status: 'final',
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('RESOURCE_BUSINESS_MISMATCH');
    });
  });

  describe('invoice.update policy', () => {
    it('should allow updating draft invoice in open period', async () => {
      const policies = getInvoicePolicies();
      const updatePolicy = policies.find(p => p.action === 'update')!;

      const resource = {
        id: 'invoice-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        status: 'draft',
        invoice_date: '2024-01-15',
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(updatePolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny updating finalized invoice', async () => {
      const policies = getInvoicePolicies();
      const updatePolicy = policies.find(p => p.action === 'update')!;

      const resource = {
        id: 'invoice-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        status: 'final',
        invoice_date: '2024-01-15',
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(updatePolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorMessage).toBe('Cannot update finalized or cancelled invoices');
      expect(result.errorCode).toBe('INVALID_RESOURCE_STATUS');
    });

    it('should deny updating invoice in locked period', async () => {
      isPeriodLocked.mockResolvedValue(true);

      const policies = getInvoicePolicies();
      const updatePolicy = policies.find(p => p.action === 'update')!;

      const resource = {
        id: 'invoice-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        status: 'draft',
        invoice_date: '2024-01-15',
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(updatePolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('PERIOD_LOCKED');
    });
  });

  describe('invoice.finalize policy', () => {
    it('should allow finalizing draft invoice', async () => {
      const policies = getInvoicePolicies();
      const finalizePolicy = policies.find(p => p.action === 'finalize')!;

      const resource = {
        id: 'invoice-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        status: 'draft',
        invoice_date: '2024-01-15',
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(finalizePolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny finalizing non-draft invoice', async () => {
      const policies = getInvoicePolicies();
      const finalizePolicy = policies.find(p => p.action === 'finalize')!;

      const resource = {
        id: 'invoice-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        status: 'final',
        invoice_date: '2024-01-15',
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(finalizePolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorMessage).toBe('Can only finalize draft invoices');
    });
  });

  describe('invoice.cancel policy', () => {
    it('should allow cancelling non-cancelled invoice', async () => {
      const policies = getInvoicePolicies();
      const cancelPolicy = policies.find(p => p.action === 'cancel')!;

      const resource = {
        id: 'invoice-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        status: 'final',
        invoice_date: '2024-01-15',
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(cancelPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny cancelling already cancelled invoice', async () => {
      const policies = getInvoicePolicies();
      const cancelPolicy = policies.find(p => p.action === 'cancel')!;

      const resource = {
        id: 'invoice-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        status: 'cancelled',
        invoice_date: '2024-01-15',
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(cancelPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorMessage).toBe('Invoice is already cancelled');
    });
  });
});
