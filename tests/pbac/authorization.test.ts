/**
 * PBAC Authorization Integration Tests
 * 
 * Tests for authorize() function with PBAC integration
 */

import { authorize, AuthorizationError } from '../../lib/authorization';

// Mock dependencies
jest.mock('../../lib/permissions');
jest.mock('../../lib/branch-access', () => ({
  checkUserBranchPermission: jest.fn(),
  getUserBranches: jest.fn(),
}));
jest.mock('../../lib/warehouse-access', () => ({
  checkUserWarehousePermission: jest.fn(),
  getUserWarehouses: jest.fn(),
}));
jest.mock('../../lib/db');
jest.mock('../../lib/policies/engine');
// Create a mock registry that can store and retrieve policies
const mockPoliciesMap = new Map();

jest.mock('../../lib/policies/registry', () => {
  return {
    getPolicyRegistry: jest.fn(() => ({
      getPolicies: jest.fn((resource: string, action: string) => {
        const key = `${resource}:${action}`;
        const policies = mockPoliciesMap.get(key);
        return policies || [];
      }),
    })),
  };
});

const { checkUserPermission } = require('../../lib/permissions');
const { checkUserBranchPermission, getUserBranches } = require('../../lib/branch-access');
const { checkUserWarehousePermission, getUserWarehouses } = require('../../lib/warehouse-access');
const { queryOne } = require('../../lib/db');
const { evaluatePolicy } = require('../../lib/policies/engine');
const { getPolicyRegistry } = require('../../lib/policies/registry');

describe('Authorization with PBAC', () => {
  const userId = 'user-1';
  const businessId = 'business-1';
  const branchId = 'branch-1';

  beforeEach(() => {
    jest.clearAllMocks();
    mockPoliciesMap.clear();

    // Default mocks
    queryOne.mockResolvedValue({
      business_id: businessId,
      role_id: 'role-1',
    });

    checkUserPermission.mockResolvedValue(true);
    checkUserBranchPermission.mockResolvedValue(true);
    checkUserWarehousePermission.mockResolvedValue(true);
    getUserBranches.mockResolvedValue([{ branch_id: branchId }]);
    getUserWarehouses.mockResolvedValue([]);
  });

  describe('RBAC + PBAC Flow', () => {
    it('should deny when RBAC permission is missing', async () => {
      checkUserPermission.mockResolvedValue(false);

      await expect(
        authorize(userId, 'invoice', 'read', { businessId })
      ).rejects.toThrow(AuthorizationError);

      expect(checkUserPermission).toHaveBeenCalledWith(userId, 'invoice', 'read');
    });

    it('should deny when branch access is missing', async () => {
      checkUserBranchPermission.mockResolvedValue(false);

      await expect(
        authorize(userId, 'invoice', 'read', { branchId, businessId })
      ).rejects.toThrow(AuthorizationError);

      expect(checkUserBranchPermission).toHaveBeenCalled();
    });

    it('should proceed to PBAC when RBAC passes', async () => {
      // Store policy in mock registry
      mockPoliciesMap.set('invoice:read', [
        {
          resource: 'invoice',
          action: 'read',
          requiresPermission: 'invoices.read',
          conditions: [],
        },
      ]);

      evaluatePolicy.mockResolvedValue({ allowed: true });

      await authorize(userId, 'invoice', 'read', { branchId, businessId });

      expect(checkUserPermission).toHaveBeenCalled();
    });

    it('should deny when PBAC policy fails', async () => {
      // Store policy in mock registry
      mockPoliciesMap.set('invoice:update', [
        {
          resource: 'invoice',
          action: 'update',
          requiresPermission: 'invoices.update', // Policies use plural format
          conditions: [],
        },
      ]);

      evaluatePolicy.mockResolvedValue({
        allowed: false,
        errorMessage: 'Cannot update finalized invoices',
        errorCode: 'INVALID_RESOURCE_STATUS',
        failedCondition: {
          id: 'status_check',
          description: 'Status check failed',
        },
      });

      await expect(
        authorize(userId, 'invoice', 'update', {
          branchId,
          businessId,
          resourceId: 'invoice-1',
        })
      ).rejects.toThrow(AuthorizationError);

      const error = await authorize(userId, 'invoice', 'update', {
        branchId,
        businessId,
        resourceId: 'invoice-1',
      }).catch(e => e);

      expect(error).toBeInstanceOf(AuthorizationError);
      expect(error.message).toBe('Cannot update finalized invoices');
      expect(error.code).toBe('INVALID_RESOURCE_STATUS');
    });

    it('should allow when RBAC and PBAC both pass', async () => {
      // Store policy in mock registry
      mockPoliciesMap.set('invoice:read', [
        {
          resource: 'invoice',
          action: 'read',
          requiresPermission: 'invoices.read',
          conditions: [],
        },
      ]);

      evaluatePolicy.mockResolvedValue({ allowed: true });

      await expect(
        authorize(userId, 'invoice', 'read', { branchId, businessId })
      ).resolves.not.toThrow();
    });
  });

  describe('Backward Compatibility', () => {
    it('should allow access when no policies exist (backward compatibility)', async () => {
      // Set default-deny to false for backward compatibility test
      process.env.PBAC_DEFAULT_DENY = 'false';
      
      // Don't store any policies - should return empty array
      mockPoliciesMap.set('purchase:read', []);

      await expect(
        authorize(userId, 'purchase', 'read', { businessId })
      ).resolves.not.toThrow();

      // RBAC passed, no policies = allow (backward compatibility)
      expect(evaluatePolicy).not.toHaveBeenCalled();
      
      delete process.env.PBAC_DEFAULT_DENY;
    });
  });
});
