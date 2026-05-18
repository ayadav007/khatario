/**
 * Warehouse Policies Integration Tests
 * 
 * Tests for warehouse-specific PBAC policies
 */

import { getWarehousePolicies } from '../../lib/policies/resources/warehouses';
import { evaluatePolicy } from '../../lib/policies/engine';
import { PolicyUser, PolicyContext } from '../../lib/policies/types';

// Mock dependencies - shared mock objects ensure mocks work with dynamic imports
const warehouseAccessMocks = {
  checkUserWarehousePermission: jest.fn(),
  isWarehouseAccessibleByBranch: jest.fn(),
};

const branchAccessMocks = {
  checkUserBranchPermission: jest.fn(),
};

// Mock warehouse-access - factory function ensures mocks work with dynamic imports
jest.mock('../../lib/warehouse-access', () => warehouseAccessMocks);

// Mock branch-access
jest.mock('../../lib/branch-access', () => branchAccessMocks);

describe('Warehouse Policies', () => {
  const mockUser: PolicyUser = {
    id: 'user-1',
    business_id: 'business-1',
    role_id: 'role-1',
    branch_ids: ['branch-1'],
    warehouse_ids: ['warehouse-1'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Use mockImplementation to ensure it works with dynamic imports
    warehouseAccessMocks.checkUserWarehousePermission.mockImplementation((userId: string, warehouseId: string, permission: string) => {
      return Promise.resolve(true);
    });
    branchAccessMocks.checkUserBranchPermission.mockImplementation((userId: string, branchId: string, permission: string) => {
      return Promise.resolve(true);
    });
  });

  describe('warehouse.read policy', () => {
    it('should allow reading warehouse user has access to', async () => {
      const policies = getWarehousePolicies();
      const readPolicy = policies.find(p => p.action === 'read')!;

      const resource = {
        id: 'warehouse-1',
        warehouse_id: 'warehouse-1', // Add warehouse_id for condition
        business_id: 'business-1',
        branch_id: 'branch-1',
        is_active: true,
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
      expect(checkUserWarehousePermission).toHaveBeenCalled();
    });

    it('should deny reading warehouse user lacks access to', async () => {
      warehouseAccessMocks.checkUserWarehousePermission.mockResolvedValue(false);

      const policies = getWarehousePolicies();
      const readPolicy = policies.find(p => p.action === 'read')!;

      const resource = {
        id: 'warehouse-2',
        warehouse_id: 'warehouse-2',
        business_id: 'business-1',
        branch_id: 'branch-1',
        is_active: true,
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('WAREHOUSE_ACCESS_DENIED');
    });

    it('should deny reading warehouse from different business', async () => {
      const policies = getWarehousePolicies();
      const readPolicy = policies.find(p => p.action === 'read')!;

      const resource = {
        id: 'warehouse-1',
        business_id: 'business-2', // Different business
        branch_id: 'branch-1',
        is_active: true,
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('RESOURCE_BUSINESS_MISMATCH');
    });

    it('should deny reading inactive warehouse', async () => {
      const policies = getWarehousePolicies();
      const readPolicy = policies.find(p => p.action === 'read')!;

      const resource = {
        id: 'warehouse-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        is_active: false,
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('WAREHOUSE_INACTIVE');
    });
  });

  describe('warehouse.create policy', () => {
    it('should allow creating warehouse with branch access', async () => {
      const policies = getWarehousePolicies();
      const createPolicy = policies.find(p => p.action === 'create')!;

      const resource = {
        business_id: 'business-1',
        branch_id: 'branch-1',
      };
      const context: PolicyContext = { resource, branchId: 'branch-1' };

      const result = await evaluatePolicy(createPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny creating warehouse without branch access', async () => {
      branchAccessMocks.checkUserBranchPermission.mockResolvedValue(false);

      const policies = getWarehousePolicies();
      const createPolicy = policies.find(p => p.action === 'create')!;

      const resource = {
        business_id: 'business-1',
        branch_id: 'branch-2', // Different branch
      };
      const context: PolicyContext = { resource, branchId: 'branch-2' };

      const result = await evaluatePolicy(createPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('WAREHOUSE_BRANCH_MISMATCH');
    });
  });

  describe('warehouse.update policy', () => {
    it('should allow updating accessible warehouse', async () => {
      const policies = getWarehousePolicies();
      const updatePolicy = policies.find(p => p.action === 'update')!;

      const resource = {
        id: 'warehouse-1',
        warehouse_id: 'warehouse-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        is_active: true,
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(updatePolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny updating warehouse user lacks access to', async () => {
      warehouseAccessMocks.checkUserWarehousePermission.mockResolvedValue(false);

      const policies = getWarehousePolicies();
      const updatePolicy = policies.find(p => p.action === 'update')!;

      const resource = {
        id: 'warehouse-2',
        warehouse_id: 'warehouse-2',
        business_id: 'business-1',
        branch_id: 'branch-1',
        is_active: true,
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(updatePolicy, mockUser, context);

      expect(result.allowed).toBe(false);
    });
  });

  describe('warehouse.delete policy', () => {
    it('should allow deleting accessible warehouse', async () => {
      const policies = getWarehousePolicies();
      const deletePolicy = policies.find(p => p.action === 'delete')!;

      const resource = {
        id: 'warehouse-1',
        warehouse_id: 'warehouse-1',
        business_id: 'business-1',
        branch_id: 'branch-1',
        is_active: true,
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(deletePolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny deleting warehouse from different business', async () => {
      const policies = getWarehousePolicies();
      const deletePolicy = policies.find(p => p.action === 'delete')!;

      const resource = {
        id: 'warehouse-1',
        business_id: 'business-2', // Different business
        branch_id: 'branch-1',
        is_active: true,
      };
      const context: PolicyContext = { resource };

      const result = await evaluatePolicy(deletePolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('RESOURCE_BUSINESS_MISMATCH');
    });
  });
});
