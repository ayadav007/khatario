/**
 * Branch Resolution Helpers
 * 
 * Provides utilities for resolving branch IDs, ensuring every business
 * always has a valid branch context, even when branch_id is not provided.
 * 
 * CRITICAL: All APIs must use resolveBranchId() instead of raw branch_id
 * to ensure proper default branch fallback and validation.
 */

import { queryOne, query } from './db';

/**
 * Assign all users in a business to the default branch
 * This is called when a default branch is auto-created
 */
async function ensureAllUsersHaveDefaultBranchAccess(businessId: string, defaultBranchId: string): Promise<void> {
  try {
    // Get all users for this business
    const users = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM users WHERE business_id = $1',
      [businessId]
    );

    if (!users || parseInt(users.count || '0') === 0) {
      return; // No users to assign
    }

    // Import the helper function
    const { ensureUserHasDefaultBranchAccess } = await import('./branch-access');
    
    // Get all user IDs for this business
    const { queryRows } = await import('./db');
    const userIds = await queryRows<{ id: string }>(
      'SELECT id FROM users WHERE business_id = $1',
      [businessId]
    );

    // Assign each user to the default branch
    for (const user of userIds) {
      await ensureUserHasDefaultBranchAccess(user.id);
    }

    console.log(`Assigned ${userIds.length} users to default branch ${defaultBranchId} for business ${businessId}`);
  } catch (error) {
    console.error('Error ensuring all users have default branch access:', error);
    // Don't throw - this is a helper, failures shouldn't break branch creation
  }
}

export class BranchResolutionError extends Error {
  constructor(message: string, public code: string = 'BRANCH_RESOLUTION_ERROR') {
    super(message);
    this.name = 'BranchResolutionError';
  }
}

/**
 * Resolves the effective branch ID for a business.
 * 
 * Behavior:
 * - If branchId is provided → validates ownership and returns it
 * - If branchId is missing → returns the default branch for the business
 * - Throws error if no default branch exists (should never happen)
 * 
 * @param options.branchId - Optional explicit branch ID
 * @param options.businessId - Required business ID
 * @returns The resolved branch ID (always a valid UUID)
 * @throws BranchResolutionError if branch doesn't belong to business or no default branch exists
 */
export async function resolveBranchId({
  branchId,
  businessId,
}: {
  branchId?: string | null;
  businessId: string;
}): Promise<string> {
  if (!businessId) {
    throw new BranchResolutionError(
      'business_id is required for branch resolution',
      'BUSINESS_ID_REQUIRED'
    );
  }

  // If branch_id is provided, validate it belongs to the business
  if (branchId) {
    const branch = await queryOne<{ id: string; business_id: string; is_active: boolean }>(
      `SELECT id, business_id, is_active
       FROM branches
       WHERE id = $1`,
      [branchId]
    );

    if (!branch) {
      throw new BranchResolutionError(
        `Branch ${branchId} not found`,
        'BRANCH_NOT_FOUND'
      );
    }

    if (branch.business_id !== businessId) {
      throw new BranchResolutionError(
        `Branch ${branchId} does not belong to business ${businessId}`,
        'BRANCH_BUSINESS_MISMATCH'
      );
    }

    if (!branch.is_active) {
      throw new BranchResolutionError(
        `Branch ${branchId} is not active`,
        'BRANCH_INACTIVE'
      );
    }

    return branch.id;
  }

  // Branch ID not provided - get default branch
  const defaultBranch = await queryOne<{ id: string }>(
    `SELECT id
     FROM branches
     WHERE business_id = $1
       AND is_default = true
       AND is_active = true
     LIMIT 1`,
    [businessId]
  );

  if (!defaultBranch) {
    // Auto-fix: Create a default branch if one doesn't exist
    // This handles cases where businesses were created before migration 128
    console.warn(`No default branch found for business ${businessId}. Auto-creating default branch...`);
    
    try {
      // Check if business exists
      const business = await queryOne<{ id: string; name: string }>(
        'SELECT id, name FROM businesses WHERE id = $1',
        [businessId]
      );

      if (!business) {
        throw new BranchResolutionError(
          `Business ${businessId} not found`,
          'BUSINESS_NOT_FOUND'
        );
      }

      // Check if there are any branches at all
      const existingBranches = await queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM branches WHERE business_id = $1`,
        [businessId]
      );

      const branchCount = parseInt(existingBranches?.count || '0');

      if (branchCount === 0) {
        // No branches exist - create a new default branch
        const newBranch = await queryOne<{ id: string }>(
          `INSERT INTO branches (business_id, name, is_default, is_active)
           VALUES ($1, $2, true, true)
           RETURNING id`,
          [businessId, 'Main Branch']
        );

        if (!newBranch) {
          throw new BranchResolutionError(
            `Failed to create default branch for business ${businessId}`,
            'BRANCH_CREATION_FAILED'
          );
        }

          console.log(`Created default branch ${newBranch.id} for business ${businessId}`);
          
          // Assign all existing users in this business to the newly created default branch
          await ensureAllUsersHaveDefaultBranchAccess(businessId, newBranch.id);
          
        return newBranch.id;
      } else {
        // Branches exist but none is marked as default - fix it
        const firstBranch = await queryOne<{ id: string }>(
          `SELECT id FROM branches 
           WHERE business_id = $1 AND is_active = true 
           ORDER BY created_at ASC 
           LIMIT 1`,
          [businessId]
        );

        if (firstBranch) {
          // Set the first active branch as default
          await query(
            `UPDATE branches 
             SET is_default = true 
             WHERE id = $1`,
            [firstBranch.id]
          );

          // Unset any other default branches
          await query(
            `UPDATE branches 
             SET is_default = false 
             WHERE business_id = $1 AND id != $2`,
            [businessId, firstBranch.id]
          );

          console.log(`Set branch ${firstBranch.id} as default for business ${businessId}`);
          return firstBranch.id;
        } else {
          // No active branches - create one
          const newBranch = await queryOne<{ id: string }>(
            `INSERT INTO branches (business_id, name, is_default, is_active)
             VALUES ($1, $2, true, true)
             RETURNING id`,
            [businessId, 'Main Branch']
          );

          if (!newBranch) {
            throw new BranchResolutionError(
              `Failed to create default branch for business ${businessId}`,
              'BRANCH_CREATION_FAILED'
            );
          }

          console.log(`Created default branch ${newBranch.id} for business ${businessId}`);
          
          // Assign all existing users in this business to the newly created default branch
          await ensureAllUsersHaveDefaultBranchAccess(businessId, newBranch.id);
          
        return newBranch.id;
      }
    }
  } catch (error: any) {
      if (error instanceof BranchResolutionError) {
        throw error;
      }
      console.error('Error auto-creating default branch:', error);
      throw new BranchResolutionError(
        `No default branch found for business ${businessId} and auto-creation failed: ${error.message}. Please contact support.`,
        'NO_DEFAULT_BRANCH'
      );
    }
  }

  return defaultBranch.id;
}

/**
 * Gets the default branch ID for a business (without validation)
 * 
 * @param businessId - Business ID
 * @returns Default branch ID or null if not found
 */
export async function getDefaultBranchId(businessId: string): Promise<string | null> {
  const branch = await queryOne<{ id: string }>(
    `SELECT id
     FROM branches
     WHERE business_id = $1
       AND is_default = true
       AND is_active = true
     LIMIT 1`,
    [businessId]
  );

  return branch?.id || null;
}

/**
 * Checks if a branch is the default branch for a business
 * 
 * @param branchId - Branch ID to check
 * @param businessId - Business ID
 * @returns true if branch is the default branch
 */
export async function isDefaultBranch(branchId: string, businessId: string): Promise<boolean> {
  const branch = await queryOne<{ is_default: boolean; business_id: string }>(
    `SELECT is_default, business_id
     FROM branches
     WHERE id = $1`,
    [branchId]
  );

  if (!branch || branch.business_id !== businessId) {
    return false;
  }

  return branch.is_default === true;
}

/**
 * Validates that a user has access to a specific branch
 * 
 * @param userId - User ID
 * @param branchId - Branch ID to validate
 * @returns true if user has access, false otherwise
 * @throws Error if validation fails
 */
export async function validateUserBranchAccess(userId: string, branchId: string): Promise<boolean> {
  const { getUserAccessibleBranchIds } = await import('./branch-access');
  const accessibleBranchIds = await getUserAccessibleBranchIds(userId);
  
  if (accessibleBranchIds.length === 0) {
    return false;
  }
  
  return accessibleBranchIds.includes(branchId);
}