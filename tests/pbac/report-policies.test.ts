/**
 * Report Policies Integration Tests
 * 
 * Tests for report-specific PBAC policies
 */

import { getReportPolicies } from '../../lib/policies/resources/reports';
import { evaluatePolicy } from '../../lib/policies/engine';
import { PolicyUser, PolicyContext } from '../../lib/policies/types';

// Mock dependencies
jest.mock('../../lib/branch-access', () => ({
  checkUserBranchPermission: jest.fn(),
}));

jest.mock('../../lib/warehouse-access', () => ({
  checkUserWarehousePermission: jest.fn(),
}));

describe('Report Policies', () => {
  const mockUser: PolicyUser = {
    id: 'user-1',
    business_id: 'business-1',
    role_id: 'role-1',
    branch_ids: ['branch-1'],
    warehouse_ids: ['warehouse-1'],
  };

  const { checkUserBranchPermission } = require('../../lib/branch-access');
  const { checkUserWarehousePermission } = require('../../lib/warehouse-access');

  beforeEach(() => {
    jest.clearAllMocks();
    checkUserBranchPermission.mockResolvedValue(true);
    checkUserWarehousePermission.mockResolvedValue(true);
  });

  describe('report.read policy', () => {
    it('should allow reading report from accessible branch', async () => {
      const policies = getReportPolicies();
      const readPolicy = policies.find(p => p.resource === 'report' && p.action === 'read')!;

      const resource = {
        business_id: 'business-1',
        branch_id: 'branch-1',
      };
      const context: PolicyContext = {
        businessId: 'business-1',
        branchId: 'branch-1',
        resource,
      };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
      expect(checkUserBranchPermission).toHaveBeenCalledWith('user-1', 'branch-1', 'view');
    });

    it('should allow reading report without branch filter (all branches)', async () => {
      const policies = getReportPolicies();
      const readPolicy = policies.find(p => p.resource === 'report' && p.action === 'read')!;

      const resource = {
        business_id: 'business-1',
        branch_id: null,
      };
      const context: PolicyContext = {
        businessId: 'business-1',
        resource,
      };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
      // Should not check branch permission when no branch specified
      expect(checkUserBranchPermission).not.toHaveBeenCalled();
    });

    it('should deny reading report from inaccessible branch', async () => {
      checkUserBranchPermission.mockResolvedValue(false);

      const policies = getReportPolicies();
      const readPolicy = policies.find(p => p.resource === 'report' && p.action === 'read')!;

      const resource = {
        business_id: 'business-1',
        branch_id: 'branch-2', // Different branch
      };
      const context: PolicyContext = {
        businessId: 'business-1',
        branchId: 'branch-2',
        resource,
      };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('BRANCH_ACCESS_DENIED');
    });

    it('should deny reading report from different business', async () => {
      const policies = getReportPolicies();
      const readPolicy = policies.find(p => p.resource === 'report' && p.action === 'read')!;

      const resource = {
        business_id: 'business-2', // Different business
        branch_id: 'branch-1',
      };
      const context: PolicyContext = {
        businessId: 'business-2',
        branchId: 'branch-1',
        resource,
      };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('RESOURCE_BUSINESS_MISMATCH');
    });
  });

  describe('report.inventory.read policy', () => {
    it('should allow reading inventory report from accessible warehouse', async () => {
      const policies = getReportPolicies();
      const readPolicy = policies.find(p => p.resource === 'report.inventory' && p.action === 'read')!;

      const resource = {
        business_id: 'business-1',
        warehouse_id: 'warehouse-1',
      };
      const context: PolicyContext = {
        businessId: 'business-1',
        warehouseId: 'warehouse-1',
        resource,
      };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
      expect(checkUserWarehousePermission).toHaveBeenCalledWith('user-1', 'warehouse-1', 'view');
    });

    it('should allow reading inventory report without warehouse filter', async () => {
      const policies = getReportPolicies();
      const readPolicy = policies.find(p => p.resource === 'report.inventory' && p.action === 'read')!;

      const resource = {
        business_id: 'business-1',
        warehouse_id: null,
      };
      const context: PolicyContext = {
        businessId: 'business-1',
        resource,
      };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
      expect(checkUserWarehousePermission).not.toHaveBeenCalled();
    });

    it('should deny reading inventory report from inaccessible warehouse', async () => {
      checkUserWarehousePermission.mockResolvedValue(false);

      const policies = getReportPolicies();
      const readPolicy = policies.find(p => p.resource === 'report.inventory' && p.action === 'read')!;

      const resource = {
        business_id: 'business-1',
        warehouse_id: 'warehouse-2', // Different warehouse
      };
      const context: PolicyContext = {
        businessId: 'business-1',
        warehouseId: 'warehouse-2',
        resource,
      };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('WAREHOUSE_ACCESS_DENIED');
    });
  });

  describe('report.financial.read policy', () => {
    it('should allow reading financial report from accessible branch', async () => {
      const policies = getReportPolicies();
      const readPolicy = policies.find(p => p.resource === 'report.financial' && p.action === 'read')!;

      const resource = {
        business_id: 'business-1',
        branch_id: 'branch-1',
      };
      const context: PolicyContext = {
        businessId: 'business-1',
        branchId: 'branch-1',
        resource,
      };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
      expect(checkUserBranchPermission).toHaveBeenCalledWith('user-1', 'branch-1', 'view');
    });

    it('should deny reading financial report from inaccessible branch', async () => {
      checkUserBranchPermission.mockResolvedValue(false);

      const policies = getReportPolicies();
      const readPolicy = policies.find(p => p.resource === 'report.financial' && p.action === 'read')!;

      const resource = {
        business_id: 'business-1',
        branch_id: 'branch-2',
      };
      const context: PolicyContext = {
        businessId: 'business-1',
        branchId: 'branch-2',
        resource,
      };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('BRANCH_ACCESS_DENIED');
    });
  });

  describe('report.export policy', () => {
    it('should allow exporting report when user has export permission and branch access', async () => {
      const policies = getReportPolicies();
      const exportPolicy = policies.find(p => p.resource === 'report' && p.action === 'export')!;

      const resource = {
        business_id: 'business-1',
        branch_id: 'branch-1',
      };
      const context: PolicyContext = {
        businessId: 'business-1',
        branchId: 'branch-1',
        resource,
      };

      const result = await evaluatePolicy(exportPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
      expect(checkUserBranchPermission).toHaveBeenCalledWith('user-1', 'branch-1', 'view');
    });

    it('should deny exporting report from inaccessible branch', async () => {
      checkUserBranchPermission.mockResolvedValue(false);

      const policies = getReportPolicies();
      const exportPolicy = policies.find(p => p.resource === 'report' && p.action === 'export')!;

      const resource = {
        business_id: 'business-1',
        branch_id: 'branch-2',
      };
      const context: PolicyContext = {
        businessId: 'business-1',
        branchId: 'branch-2',
        resource,
      };

      const result = await evaluatePolicy(exportPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('BRANCH_ACCESS_DENIED');
    });
  });

  describe('report.gst.read policy', () => {
    it('should allow reading GST report from accessible branch', async () => {
      const policies = getReportPolicies();
      const readPolicy = policies.find(p => p.resource === 'report.gst' && p.action === 'read')!;

      const resource = {
        business_id: 'business-1',
        branch_id: 'branch-1',
      };
      const context: PolicyContext = {
        businessId: 'business-1',
        branchId: 'branch-1',
        resource,
      };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
      expect(checkUserBranchPermission).toHaveBeenCalledWith('user-1', 'branch-1', 'view');
    });

    it('should deny reading GST report from inaccessible branch', async () => {
      checkUserBranchPermission.mockResolvedValue(false);

      const policies = getReportPolicies();
      const readPolicy = policies.find(p => p.resource === 'report.gst' && p.action === 'read')!;

      const resource = {
        business_id: 'business-1',
        branch_id: 'branch-2',
      };
      const context: PolicyContext = {
        businessId: 'business-1',
        branchId: 'branch-2',
        resource,
      };

      const result = await evaluatePolicy(readPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('BRANCH_ACCESS_DENIED');
    });
  });

  describe('report.gst.export policy', () => {
    it('should allow exporting GST report when user has export permission and branch access', async () => {
      const policies = getReportPolicies();
      const exportPolicy = policies.find(p => p.resource === 'report.gst' && p.action === 'export')!;

      const resource = {
        business_id: 'business-1',
        branch_id: 'branch-1',
      };
      const context: PolicyContext = {
        businessId: 'business-1',
        branchId: 'branch-1',
        resource,
      };

      const result = await evaluatePolicy(exportPolicy, mockUser, context);

      expect(result.allowed).toBe(true);
      expect(checkUserBranchPermission).toHaveBeenCalledWith('user-1', 'branch-1', 'view');
    });

    it('should deny exporting GST report from inaccessible branch', async () => {
      checkUserBranchPermission.mockResolvedValue(false);

      const policies = getReportPolicies();
      const exportPolicy = policies.find(p => p.resource === 'report.gst' && p.action === 'export')!;

      const resource = {
        business_id: 'business-1',
        branch_id: 'branch-2',
      };
      const context: PolicyContext = {
        businessId: 'business-1',
        branchId: 'branch-2',
        resource,
      };

      const result = await evaluatePolicy(exportPolicy, mockUser, context);

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe('BRANCH_ACCESS_DENIED');
    });
  });
});
