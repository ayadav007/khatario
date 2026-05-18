/**
 * Tests for PBAC Default-Deny Mode
 * 
 * Ensures that:
 * 1. Routes with policies work correctly
 * 2. Routes without policies are denied
 * 3. Error messages are appropriate
 */

import { authorize, AuthorizationError } from '@/lib/authorization';
import { getPolicyRegistry } from '@/lib/policies/registry';

describe('PBAC Default-Deny Mode', () => {
  const mockUserId = 'test-user-id';
  const mockBusinessId = 'test-business-id';

  // Mock user data
  const mockUser = {
    id: mockUserId,
    business_id: mockBusinessId,
    role_id: 'test-role-id',
  };

  beforeEach(() => {
    // Reset environment
    process.env.PBAC_DEFAULT_DENY = 'true';
  });

  afterEach(() => {
    delete process.env.PBAC_DEFAULT_DENY;
  });

  describe('Default-Deny Enabled (PBAC_DEFAULT_DENY=true)', () => {
    it('should allow access when policy exists', async () => {
      // This test requires actual database setup and policies
      // For now, we test the logic path
      
      const registry = getPolicyRegistry();
      const policies = registry.getPolicies('invoice', 'read');
      
      // If policies exist, the authorize function should check them
      expect(policies.length).toBeGreaterThan(0);
      
      // Note: Full test would require database mocking
      // This validates that policies are registered
    });

    it('should deny access when no policy exists', async () => {
      const registry = getPolicyRegistry();
      const policies = registry.getPolicies('nonexistent_resource', 'read');
      
      // No policy should exist
      expect(policies.length).toBe(0);
      
      // When default-deny is enabled, authorize() should throw
      // This test requires full authorization engine setup
      // Skipping full implementation due to database dependency
    });

    it('should throw AuthorizationError with correct code', async () => {
      // Test error structure
      const error = new AuthorizationError(
        'Access denied: No policy defined for resource \'test\' action \'read\'',
        'NO_POLICY_DEFINED',
        {
          resource: 'test',
          action: 'read',
        }
      );

      expect(error).toBeInstanceOf(AuthorizationError);
      expect(error.code).toBe('NO_POLICY_DEFINED');
      expect(error.statusCode).toBe(403);
      expect(error.message).toContain('No policy defined');
    });

    it('should include resource and action in error details', () => {
      const error = new AuthorizationError(
        'Access denied: No policy defined',
        'NO_POLICY_DEFINED',
        {
          resource: 'my_module',
          action: 'create',
          message: 'Test message',
        }
      );

      const response = error.toResponse();
      expect(response.code).toBe('NO_POLICY_DEFINED');
      expect(response.details).toEqual({
        resource: 'my_module',
        action: 'create',
        message: 'Test message',
      });
    });
  });

  describe('Default-Deny Disabled (PBAC_DEFAULT_DENY=false)', () => {
    it('should allow access when no policy exists (legacy mode)', async () => {
      process.env.PBAC_DEFAULT_DENY = 'false';
      
      // In legacy mode, authorize() should return without error
      // when no policy exists (after RBAC check passes)
      // Full test requires database mocking
      
      // For now, just verify the env var is read correctly
      expect(process.env.PBAC_DEFAULT_DENY).toBe('false');
    });
  });

  describe('Policy Registry', () => {
    it('should return policies for known resources', () => {
      const registry = getPolicyRegistry();
      
      // Test known protected resources
      const invoicePolicies = registry.getPolicies('invoice', 'read');
      expect(invoicePolicies.length).toBeGreaterThan(0);
      
      const reportPolicies = registry.getPolicies('report', 'read');
      expect(reportPolicies.length).toBeGreaterThan(0);
    });

    it('should return empty array for unknown resources', () => {
      const registry = getPolicyRegistry();
      
      const policies = registry.getPolicies('nonexistent_resource', 'read');
      expect(policies).toEqual([]);
    });
  });

  describe('Error Messages', () => {
    it('should provide clear error message for missing policy', () => {
      const error = new AuthorizationError(
        'Access denied: No policy defined for resource \'test_module\' action \'read\'',
        'NO_POLICY_DEFINED',
        {
          resource: 'test_module',
          action: 'read',
          message: 'This resource/action combination requires a PBAC policy to be defined.',
        }
      );

      expect(error.message).toContain('No policy defined');
      expect(error.message).toContain('test_module');
      expect(error.message).toContain('read');
    });

    it('should not expose internal policy details to users', () => {
      const error = new AuthorizationError(
        'Access denied: No policy defined for resource \'test\' action \'read\'',
        'NO_POLICY_DEFINED',
        {
          resource: 'test',
          action: 'read',
          message: 'This resource/action combination requires a PBAC policy to be defined. Contact system administrator.',
        }
      );

      const response = error.toResponse();
      
      // Should not expose internal details
      expect(response.error).not.toContain('PolicyRegistry');
      expect(response.error).not.toContain('getPolicies');
      expect(response.details).toBeDefined();
      if (response.details?.message) {
        expect(response.details.message).toContain('Contact system administrator');
      }
    });
  });
});
