/**
 * Settings Bootstrap Policy Tests
 * 
 * Tests for bootstrap mode that allows creating the first role when business has zero roles.
 */

import { authorize, AuthorizationError } from '@/lib/authorization';
import { getPolicyRegistry } from '@/lib/policies/registry';

// Mock dependencies
jest.mock('@/lib/permissions');
jest.mock('@/lib/branch-access', () => ({
  checkUserBranchPermission: jest.fn(),
  getUserBranches: jest.fn(),
}));
jest.mock('@/lib/warehouse-access', () => ({
  checkUserWarehousePermission: jest.fn(),
  getUserWarehouses: jest.fn(),
}));
jest.mock('@/lib/db');
jest.mock('@/lib/policies/engine');
jest.mock('@/lib/policies/registry');

const mockCheckUserPermission = require('@/lib/permissions').checkUserPermission;
const mockQueryOne = require('@/lib/db').queryOne;
const mockGetUserBranches = require('@/lib/branch-access').getUserBranches;
const mockGetUserWarehouses = require('@/lib/warehouse-access').getUserWarehouses;
const { evaluatePolicy } = require('@/lib/policies/engine');

describe('Settings Bootstrap Mode', () => {
  const userId = 'user-123';
  const businessId = 'business-456';
  const mockPoliciesMap = new Map<string, any[]>();

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mocks
    mockCheckUserPermission.mockResolvedValue(false); // No permission by default
    mockGetUserBranches.mockResolvedValue([]);
    mockGetUserWarehouses.mockResolvedValue([]);
    
    // Mock policy registry
    const mockRegistry = {
      getPolicies: jest.fn((resource: string, action: string) => {
        const key = `${resource}:${action}`;
        return mockPoliciesMap.get(key) || [];
      }),
      getAllPolicies: jest.fn(() => []),
      registerPolicy: jest.fn((policy: any) => {
        const key = `${policy.resource}:${policy.action}`;
        const policies = mockPoliciesMap.get(key) || [];
        policies.push(policy);
        // Sort by priority (higher priority first)
        policies.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        mockPoliciesMap.set(key, policies);
      }),
    };
    
    require('@/lib/policies/registry').getPolicyRegistry.mockReturnValue(mockRegistry);
    
    // Register bootstrap policy for settings.create
    const { getToolsPolicies } = require('@/lib/policies/resources/tools');
    const toolsPolicies = getToolsPolicies();
    toolsPolicies.forEach((policy: any) => {
      mockRegistry.registerPolicy(policy);
    });
    
    // Mock policy engine to evaluate policies
    evaluatePolicy.mockImplementation(async (policy: any, user: any, context: any) => {
      // Simple policy evaluation: check all conditions
      if (!policy.conditions || policy.conditions.length === 0) {
        return { allowed: true };
      }
      
      for (const condition of policy.conditions) {
        try {
          const result = await condition.evaluate(user, context.resource || {}, context);
          if (!result) {
            return {
              allowed: false,
              failedCondition: condition,
              errorMessage: condition.errorMessage,
              errorCode: condition.errorCode,
            };
          }
        } catch (error: any) {
          return {
            allowed: false,
            failedCondition: condition,
            errorMessage: condition.errorMessage || `Condition evaluation error: ${error.message}`,
            errorCode: condition.errorCode || 'CONDITION_ERROR',
          };
        }
      }
      
      return { allowed: true };
    });
    
    // Mock user query
    mockQueryOne.mockImplementation(async (query: string, params: any[]) => {
      if (query.includes('SELECT business_id FROM users WHERE id')) {
        return { business_id: businessId };
      }
      if (query.includes('SELECT business_id, role_id FROM users WHERE id')) {
        return { business_id: businessId, role_id: null };
      }
      if (query.includes('SELECT COUNT(*) as count FROM user_roles WHERE business_id')) {
        // Return role count based on test scenario (will be overridden in tests)
        return { count: '0' };
      }
      return null;
    });
  });

  afterEach(() => {
    mockPoliciesMap.clear();
  });

  describe('Bootstrap Mode - First Role Creation', () => {
    it('should allow settings.create when business has zero roles (bootstrap mode)', async () => {
      // Setup: Business has zero roles
      mockQueryOne.mockImplementation(async (query: string, params: any[]) => {
        if (query.includes('SELECT business_id FROM users WHERE id')) {
          return { business_id: businessId };
        }
        if (query.includes('SELECT business_id, role_id FROM users WHERE id')) {
          return { business_id: businessId, role_id: null };
        }
        if (query.includes('SELECT COUNT(*) as count FROM user_roles WHERE business_id')) {
          return { count: '0' }; // Zero roles
        }
        return null;
      });

      // User has no permission (but bootstrap mode should allow)
      mockCheckUserPermission.mockResolvedValue(false);

      // Should not throw - bootstrap mode allows access
      await expect(
        authorize(userId, 'settings', 'create', { businessId })
      ).resolves.not.toThrow();
    });

    it('should deny settings.create when business has roles (after bootstrap)', async () => {
      // Setup: Business has one role (bootstrap mode disabled)
      mockQueryOne.mockImplementation(async (query: string, params: any[]) => {
        if (query.includes('SELECT business_id FROM users WHERE id')) {
          return { business_id: businessId };
        }
        if (query.includes('SELECT business_id, role_id FROM users WHERE id')) {
          return { business_id: businessId, role_id: null };
        }
        if (query.includes('SELECT COUNT(*) as count FROM user_roles WHERE business_id')) {
          return { count: '1' }; // One role exists
        }
        return null;
      });

      // User has no permission
      mockCheckUserPermission.mockResolvedValue(false);

      // Should throw - bootstrap mode disabled, permission required
      await expect(
        authorize(userId, 'settings', 'create', { businessId })
      ).rejects.toThrow(AuthorizationError);
      
      await expect(
        authorize(userId, 'settings', 'create', { businessId })
      ).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
    });

    it('should allow settings.create when business has roles and user has permission', async () => {
      // Setup: Business has one role
      mockQueryOne.mockImplementation(async (query: string, params: any[]) => {
        if (query.includes('SELECT business_id FROM users WHERE id')) {
          return { business_id: businessId };
        }
        if (query.includes('SELECT business_id, role_id FROM users WHERE id')) {
          return { business_id: businessId, role_id: null };
        }
        if (query.includes('SELECT COUNT(*) as count FROM user_roles WHERE business_id')) {
          return { count: '1' }; // One role exists
        }
        return null;
      });

      // User has permission
      mockCheckUserPermission.mockResolvedValue(true);

      // Should not throw - user has permission
      await expect(
        authorize(userId, 'settings', 'create', { businessId })
      ).resolves.not.toThrow();
    });

    it('should enforce business ownership in bootstrap mode', async () => {
      // Setup: Business has zero roles, but wrong business_id in context
      const wrongBusinessId = 'wrong-business';
      mockQueryOne.mockImplementation(async (query: string, params: any[]) => {
        if (query.includes('SELECT business_id FROM users WHERE id')) {
          return { business_id: businessId }; // User belongs to businessId
        }
        if (query.includes('SELECT business_id, role_id FROM users WHERE id')) {
          return { business_id: businessId, role_id: null };
        }
        if (query.includes('SELECT COUNT(*) as count FROM user_roles WHERE business_id')) {
          // Check role count for the business in context (wrongBusinessId)
          if (params[0] === wrongBusinessId) {
            return { count: '0' };
          }
          return { count: '0' };
        }
        return null;
      });

      mockCheckUserPermission.mockResolvedValue(false);

      // Should throw - business ownership check fails
      await expect(
        authorize(userId, 'settings', 'create', { businessId: wrongBusinessId })
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe('Settings Read and Update', () => {
    it('should require permission for settings.read (no bootstrap mode)', async () => {
      mockQueryOne.mockImplementation(async (query: string, params: any[]) => {
        if (query.includes('SELECT business_id, role_id FROM users WHERE id')) {
          return { business_id: businessId, role_id: null };
        }
        return null;
      });

      mockCheckUserPermission.mockResolvedValue(false);

      await expect(
        authorize(userId, 'settings', 'read', { businessId })
      ).rejects.toThrow(AuthorizationError);
      
      await expect(
        authorize(userId, 'settings', 'read', { businessId })
      ).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
    });

    it('should require permission for settings.update (no bootstrap mode)', async () => {
      mockQueryOne.mockImplementation(async (query: string, params: any[]) => {
        if (query.includes('SELECT business_id, role_id FROM users WHERE id')) {
          return { business_id: businessId, role_id: null };
        }
        return null;
      });

      mockCheckUserPermission.mockResolvedValue(false);

      await expect(
        authorize(userId, 'settings', 'update', { businessId })
      ).rejects.toThrow(AuthorizationError);
      
      await expect(
        authorize(userId, 'settings', 'update', { businessId })
      ).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
    });
  });
});
