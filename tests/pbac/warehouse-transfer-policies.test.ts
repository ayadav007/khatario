/**
 * Warehouse Transfer Policies Integration Tests
 * 
 * Tests for warehouse transfer-specific PBAC policies
 */

import { getWarehouseTransferPolicies } from '../../lib/policies/resources/warehouse-transfers';
import { evaluatePolicy } from '../../lib/policies/engine';
import { PolicyUser, PolicyContext } from '../../lib/policies/types';

// Mock dependencies - shared mock object ensures mocks work with dynamic imports
const warehouseAccessMocks = {
  checkUserWarehousePermission: jest.fn(),
};

const periodLockMocks = {
  isPeriodLocked: jest.fn(),
};

// Mock warehouse-access - factory function ensures mocks work with dynamic imports
jest.mock('../../lib/warehouse-access', () => warehouseAccessMocks);

// Mock period-lock-utils
jest.mock('../../lib/period-lock-utils', () => periodLockMocks);

describe('Warehouse Transfer Policies', () => {
  const mockUser: PolicyUser = {
    id: 'user-1',
    business_id: 'business-1',
    role_id: 'role-1',
    branch_ids: ['branch-1'],
    warehouse_ids: ['warehouse-1', 'warehouse-2'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: allow access to all warehouses
    warehouseAccessMocks.checkUserWarehousePermission.mockImplementation((userId: string, warehouseId: string, permission: string) => {
      return Promise.resolve(true);
    });
    periodLockMocks.isPeriodLocked.mockResolvedValue(false);
  });

  describe('warehouse_transfer.create policy', () => {
    it('should allow creating transfer with access to both warehouses', async () => {
      // Explicitly set mocks to ensure they work
      warehouseAccessMocks.checkUserWarehousePermission.mockImplementation((userId: string, warehouseId: string, permission: string) => {
        return Promise.resolve(true);
      });
      
      const policies = getWarehouseTransferPolicies();
      const createPolicy = policies.find(p => p.action === 'create')!;

      const resource = {
        business_id: 'business-1',
        from_location_id: 'warehouse-1',
        to_location_id: 'warehouse-2',
        transfer_date: '2024-01-15',
      };
      const context: PolicyContext = { 
        resource,
        sourceWarehouseId: 'warehouse-1',
        destinationWarehouseId: 'warehouse-2',
      };

      const result = await evaluatePolicy(createPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
      expect(warehouseAccessMocks.checkUserWarehousePermission).toHaveBeenCalledWith('user-1', 'warehouse-1', 'create_transactions');
      expect(warehouseAccessMocks.checkUserWarehousePermission).toHaveBeenCalledWith('user-1', 'warehouse-2', 'create_transactions');
    });

    it('should deny creating transfer without source warehouse access', async () => {
      warehouseAccessMocks.checkUserWarehousePermission.mockImplementation((userId: string, warehouseId: string, permission: string) => {
        return Promise.resolve(warehouseId !== 'warehouse-3');
      });

      const policies = getWarehouseTransferPolicies();
      const createPolicy = policies.find(p => p.action === 'create')!;

      const resource = {
        business_id: 'business-1',
        from_location_id: 'warehouse-3', // No access
        to_location_id: 'warehouse-2',
        transfer_date: '2024-01-15',
      };
      const context: PolicyContext = { 
        resource,
        sourceWarehouseId: 'warehouse-3',
        destinationWarehouseId: 'warehouse-2',
      };

      const result = await evaluatePolicy(createPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('SOURCE_WAREHOUSE_ACCESS_DENIED');
    });

    it('should deny creating transfer without destination warehouse access', async () => {
      // Allow source, deny destination - need to check warehouse IDs explicitly
      warehouseAccessMocks.checkUserWarehousePermission.mockImplementation((userId: string, warehouseId: string, permission: string) => {
        // Allow warehouse-1 (source), deny warehouse-3 (destination)
        if (warehouseId === 'warehouse-1') return Promise.resolve(true);
        if (warehouseId === 'warehouse-3') return Promise.resolve(false);
        return Promise.resolve(true);
      });

      const policies = getWarehouseTransferPolicies();
      const createPolicy = policies.find(p => p.action === 'create')!;

      const resource = {
        business_id: 'business-1',
        from_location_id: 'warehouse-1',
        to_location_id: 'warehouse-3', // No access
        transfer_date: '2024-01-15',
      };
      const context: PolicyContext = { 
        resource,
        sourceWarehouseId: 'warehouse-1',
        destinationWarehouseId: 'warehouse-3',
      };

      const result = await evaluatePolicy(createPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('DESTINATION_WAREHOUSE_ACCESS_DENIED');
    });

    it('should deny creating transfer with same source and destination', async () => {
      // Ensure both warehouses have access so the check gets to the "different" condition
      warehouseAccessMocks.checkUserWarehousePermission.mockImplementation((userId: string, warehouseId: string, permission: string) => {
        return Promise.resolve(true);
      });
      
      const policies = getWarehouseTransferPolicies();
      const createPolicy = policies.find(p => p.action === 'create')!;

      const resource = {
        business_id: 'business-1',
        from_location_id: 'warehouse-1',
        to_location_id: 'warehouse-1', // Same warehouse
        transfer_date: '2024-01-15',
      };
      const context: PolicyContext = { 
        resource,
        sourceWarehouseId: 'warehouse-1',
        destinationWarehouseId: 'warehouse-1',
      };

      const result = await evaluatePolicy(createPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('SAME_SOURCE_DESTINATION');
    });

    it('should deny creating transfer in locked period', async () => {
      periodLockMocks.isPeriodLocked.mockResolvedValue(true);

      const policies = getWarehouseTransferPolicies();
      const createPolicy = policies.find(p => p.action === 'create')!;

      const resource = {
        business_id: 'business-1',
        from_location_id: 'warehouse-1',
        to_location_id: 'warehouse-2',
        transfer_date: '2024-01-15',
      };
      const context: PolicyContext = { 
        resource,
        sourceWarehouseId: 'warehouse-1',
        destinationWarehouseId: 'warehouse-2',
        transfer_date: '2024-01-15',
      };

      const result = await evaluatePolicy(createPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('PERIOD_LOCKED');
    });
  });

  describe('warehouse_transfer.dispatch policy', () => {
    it('should allow dispatching transfer in pending status', async () => {
      // Ensure source warehouse access passes
      warehouseAccessMocks.checkUserWarehousePermission.mockImplementation((userId: string, warehouseId: string, permission: string) => {
        return Promise.resolve(true);
      });
      
      const policies = getWarehouseTransferPolicies();
      const dispatchPolicy = policies.find(p => p.action === 'dispatch')!;

      const resource = {
        id: 'transfer-1',
        business_id: 'business-1',
        from_location_id: 'warehouse-1',
        status: 'pending',
        transfer_date: '2024-01-15',
      };
      const context: PolicyContext = { 
        resource,
        sourceWarehouseId: 'warehouse-1',
        status: 'pending',
      };

      const result = await evaluatePolicy(dispatchPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny dispatching transfer not in pending status', async () => {
      // Ensure source warehouse access passes so we get to status check
      warehouseAccessMocks.checkUserWarehousePermission.mockImplementation((userId: string, warehouseId: string, permission: string) => {
        return Promise.resolve(true);
      });
      
      const policies = getWarehouseTransferPolicies();
      const dispatchPolicy = policies.find(p => p.action === 'dispatch')!;

      const resource = {
        id: 'transfer-1',
        business_id: 'business-1',
        from_location_id: 'warehouse-1',
        status: 'in_transit', // Wrong status
        transfer_date: '2024-01-15',
      };
      const context: PolicyContext = { 
        resource,
        sourceWarehouseId: 'warehouse-1',
        status: 'in_transit',
      };

      const result = await evaluatePolicy(dispatchPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('INVALID_TRANSFER_STATUS');
    });
  });

  describe('warehouse_transfer.receive policy', () => {
    it('should allow receiving transfer in in_transit status', async () => {
      // Ensure destination warehouse access passes
      warehouseAccessMocks.checkUserWarehousePermission.mockImplementation((userId: string, warehouseId: string, permission: string) => {
        return Promise.resolve(true);
      });
      
      const policies = getWarehouseTransferPolicies();
      const receivePolicy = policies.find(p => p.action === 'receive')!;

      const resource = {
        id: 'transfer-1',
        business_id: 'business-1',
        to_location_id: 'warehouse-2',
        status: 'in_transit',
        transfer_date: '2024-01-15',
      };
      const context: PolicyContext = { 
        resource,
        destinationWarehouseId: 'warehouse-2',
        status: 'in_transit',
      };

      const result = await evaluatePolicy(receivePolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny receiving transfer not in in_transit status', async () => {
      // Ensure destination warehouse access passes so we get to status check
      warehouseAccessMocks.checkUserWarehousePermission.mockImplementation((userId: string, warehouseId: string, permission: string) => {
        return Promise.resolve(true);
      });
      
      const policies = getWarehouseTransferPolicies();
      const receivePolicy = policies.find(p => p.action === 'receive')!;

      const resource = {
        id: 'transfer-1',
        business_id: 'business-1',
        to_location_id: 'warehouse-2',
        status: 'pending', // Wrong status
        transfer_date: '2024-01-15',
      };
      const context: PolicyContext = { 
        resource,
        destinationWarehouseId: 'warehouse-2',
        status: 'pending',
      };

      const result = await evaluatePolicy(receivePolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('INVALID_TRANSFER_STATUS');
    });
  });

  describe('warehouse_transfer.cancel policy', () => {
    it('should allow cancelling transfer in pending status', async () => {
      // Ensure source warehouse access passes
      warehouseAccessMocks.checkUserWarehousePermission.mockImplementation((userId: string, warehouseId: string, permission: string) => {
        return Promise.resolve(true);
      });
      
      const policies = getWarehouseTransferPolicies();
      const cancelPolicy = policies.find(p => p.action === 'cancel')!;

      const resource = {
        id: 'transfer-1',
        business_id: 'business-1',
        from_location_id: 'warehouse-1',
        status: 'pending',
        transfer_date: '2024-01-15',
      };
      const context: PolicyContext = { 
        resource,
        sourceWarehouseId: 'warehouse-1',
        status: 'pending',
      };

      const result = await evaluatePolicy(cancelPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should allow cancelling transfer in in_transit status', async () => {
      // Ensure source warehouse access passes
      warehouseAccessMocks.checkUserWarehousePermission.mockImplementation((userId: string, warehouseId: string, permission: string) => {
        return Promise.resolve(true);
      });
      
      const policies = getWarehouseTransferPolicies();
      const cancelPolicy = policies.find(p => p.action === 'cancel')!;

      const resource = {
        id: 'transfer-1',
        business_id: 'business-1',
        from_location_id: 'warehouse-1',
        status: 'in_transit',
        transfer_date: '2024-01-15',
      };
      const context: PolicyContext = { 
        resource,
        sourceWarehouseId: 'warehouse-1',
        status: 'in_transit',
      };

      const result = await evaluatePolicy(cancelPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
    });

    it('should deny cancelling completed transfer', async () => {
      // Ensure source warehouse access passes so we get to status check
      warehouseAccessMocks.checkUserWarehousePermission.mockImplementation((userId: string, warehouseId: string, permission: string) => {
        return Promise.resolve(true);
      });
      
      const policies = getWarehouseTransferPolicies();
      const cancelPolicy = policies.find(p => p.action === 'cancel')!;

      const resource = {
        id: 'transfer-1',
        business_id: 'business-1',
        from_location_id: 'warehouse-1',
        status: 'completed', // Cannot cancel
        transfer_date: '2024-01-15',
      };
      const context: PolicyContext = { 
        resource,
        sourceWarehouseId: 'warehouse-1',
        status: 'completed',
      };

      const result = await evaluatePolicy(cancelPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('INVALID_TRANSFER_STATUS');
    });
  });
});
