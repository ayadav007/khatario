import { queryOne, queryRows, getPool, query } from './db';
import { log } from './logger';

export interface BranchAccess {
  branch_id: string;
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_create_transactions: boolean;
}

/** Extended branch info for API responses (includes branch name and is_default) */
export interface BranchWithDetails extends BranchAccess {
  id: string;
  name: string;
  is_primary: boolean;
}

/**
 * Ensure a user has access to the default branch of their business
 * This is called automatically when a user is created or when a default branch is auto-created
 */
export async function ensureUserHasDefaultBranchAccess(userId: string): Promise<void> {
  try {
    const user = await queryOne<{ business_id: string }>(
      'SELECT business_id FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      log.warn('ensureUserHasDefaultBranchAccess: user not found', { userId });
      return;
    }

    // Get default branch for the business
    const defaultBranch = await queryOne<{ id: string }>(
      `SELECT id FROM branches 
       WHERE business_id = $1 AND is_default = true AND is_active = true 
       LIMIT 1`,
      [user.business_id]
    );

    if (!defaultBranch) {
      log.warn('ensureUserHasDefaultBranchAccess: no default branch for business', {
        userId,
        businessId: user.business_id,
      });
      return;
    }

    // Check if user already has access
    const existingAccess = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM user_branches WHERE user_id = $1 AND branch_id = $2',
      [userId, defaultBranch.id]
    );

    if (existingAccess) {
      return; // Already has access
    }

    // Grant full access to default branch (view, edit, delete, create_transactions)
    // Handle both old and new schema
    // NOTE: user_branches table doesn't have business_id column (it's inferred from branch_id)
    try {
      await query(
        `INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_delete, can_create_transactions)
         VALUES ($1, $2, true, true, true, true)
         ON CONFLICT (user_id, branch_id) DO NOTHING`,
        [userId, defaultBranch.id]
      );
    } catch (error: any) {
      // If can_create_transactions column doesn't exist, use old schema
      if (error.code === '42703' || error.message?.includes('can_create_transactions')) {
        await query(
          `INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_delete)
           VALUES ($1, $2, true, true, true)
           ON CONFLICT (user_id, branch_id) DO NOTHING`,
          [userId, defaultBranch.id]
        );
      } else {
        throw error;
      }
    }
  } catch (error) {
    log.error('ensureUserHasDefaultBranchAccess failed', {
      userId,
      err: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - this is a helper function, failures shouldn't break user creation
  }
}

/**
 * Check if user has access to a branch
 */
export async function checkUserBranchAccess(
  userId: string,
  branchId: string
): Promise<BranchAccess | null> {
  try {
    // Handle both old schema (without can_create_transactions) and new schema
    let access: BranchAccess | null = null;
    try {
      // Try new schema first
      access = await queryOne<BranchAccess>(`
        SELECT branch_id, can_view, can_edit, can_delete, can_create_transactions
        FROM user_branches
        WHERE user_id = $1 AND branch_id = $2
      `, [userId, branchId]);
    } catch (error: any) {
      // If column doesn't exist, try old schema
      if (error.code === '42703' || error.message?.includes('can_create_transactions')) {
        const oldAccess = await queryOne<{ branch_id: string; can_view: boolean; can_edit: boolean; can_delete: boolean }>(`
          SELECT branch_id, can_view, can_edit, can_delete
          FROM user_branches
          WHERE user_id = $1 AND branch_id = $2
        `, [userId, branchId]);
        
        if (oldAccess) {
          // Map old schema to new interface - assume can_create_transactions = can_edit
          access = {
            branch_id: oldAccess.branch_id,
            can_view: oldAccess.can_view,
            can_edit: oldAccess.can_edit,
            can_delete: oldAccess.can_delete,
            can_create_transactions: oldAccess.can_edit || false, // Default to can_edit for backward compatibility
          };
        }
      } else {
        throw error;
      }
    }

    return access;
  } catch (error) {
    console.error('Error checking user branch access:', error);
    return null;
  }
}

/**
 * Check if user has specific permission for a branch
 */
export async function checkUserBranchPermission(
  userId: string,
  branchId: string,
  permission: 'view' | 'edit' | 'delete' | 'create_transactions'
): Promise<boolean> {
  try {
    // Check branch-specific permission
    const access = await checkUserBranchAccess(userId, branchId);
    
    // If no explicit access, try to auto-assign user to default branch
    if (!access) {
      const user = await queryOne<{ business_id: string; is_primary_admin: boolean }>(
        'SELECT business_id, is_primary_admin FROM users WHERE id = $1',
        [userId]
      );

      if (!user) {
        return false;
      }

      // Check if this is the default branch for the user's business
      const branch = await queryOne<{ is_default: boolean; business_id: string }>(
        'SELECT is_default, business_id FROM branches WHERE id = $1',
        [branchId]
      );

      if (!branch || branch.business_id !== user.business_id) {
        return false; // Branch doesn't belong to user's business
      }

      // If this is the default branch, auto-assign the user to it
      if (branch.is_default) {
        // Auto-assign user to default branch
        await ensureUserHasDefaultBranchAccess(userId);
        
        // Re-check access after assignment
        const newAccess = await checkUserBranchAccess(userId, branchId);
        if (newAccess) {
          // Return permission based on the newly assigned access
          switch (permission) {
            case 'view':
              return newAccess.can_view;
            case 'edit':
              return newAccess.can_edit;
            case 'delete':
              return newAccess.can_delete;
            case 'create_transactions':
              return newAccess.can_create_transactions;
            default:
              return false;
          }
        }
      }

      // Primary admin fallback: always allow access to default branch
      if (user.is_primary_admin && branch.is_default) {
        return true;
      }

      return false;
    }

    switch (permission) {
      case 'view':
        return access.can_view;
      case 'edit':
        return access.can_edit;
      case 'delete':
        return access.can_delete;
      case 'create_transactions':
        return access.can_create_transactions;
      default:
        return false;
    }
  } catch (error) {
    console.error('Error checking user branch permission:', error);
    return false;
  }
}

/**
 * Get all branches a user can access
 */
export async function getUserBranches(userId: string): Promise<BranchWithDetails[]> {
  try {
    const user = await queryOne<{ business_id: string }>(`
      SELECT business_id FROM users WHERE id = $1
    `, [userId]);

    if (!user) {
      return [];
    }

    // Get user's assigned branches with branch details (name, is_default)
    let branches: BranchWithDetails[] = [];
    try {
      branches = await queryRows<BranchWithDetails>(`
        SELECT 
          ub.branch_id as id,
          ub.branch_id,
          b.name,
          COALESCE(b.is_default, false) as is_primary,
          ub.can_view,
          ub.can_edit,
          ub.can_delete,
          ub.can_create_transactions
        FROM user_branches ub
        JOIN branches b ON ub.branch_id = b.id
        WHERE ub.user_id = $1 AND b.is_active = true
          AND b.business_id = (SELECT business_id FROM users WHERE id = $1)
      `, [userId]);
    } catch (error: any) {
      // If column doesn't exist, try old schema
      if (error.code === '42703' || error.message?.includes('can_create_transactions')) {
        const oldBranches = await queryRows<{ branch_id: string; can_view: boolean; can_edit: boolean; can_delete: boolean }>(`
          SELECT 
            ub.branch_id,
            ub.can_view,
            ub.can_edit,
            ub.can_delete
          FROM user_branches ub
          JOIN branches b ON ub.branch_id = b.id
          WHERE ub.user_id = $1 AND b.is_active = true
        `, [userId]);
        
        // Need to fetch branch names for mapping
        const withDetails = await Promise.all(oldBranches.map(async (b) => {
          const branchInfo = await queryOne<{ name: string; is_default: boolean }>(
            'SELECT name, COALESCE(is_default, false) as is_default FROM branches WHERE id = $1',
            [b.branch_id]
          );
          return {
            branch_id: b.branch_id,
            id: b.branch_id,
            name: branchInfo?.name || 'Branch',
            is_primary: branchInfo?.is_default || false,
            can_view: b.can_view,
            can_edit: b.can_edit,
            can_delete: b.can_delete,
            can_create_transactions: b.can_edit || false,
          };
        }));
        branches = withDetails;
      } else {
        console.error('Error getting user branches:', error);
        return [];
      }
    }

    return branches;
  } catch (error) {
    console.error('Error getting user branches:', error);
    return [];
  }
}

/**
 * Assert user has permission for a branch (throws error if not)
 */
export async function assertUserBranchPermission(
  userId: string,
  branchId: string,
  permission: 'view' | 'edit' | 'delete' | 'create_transactions'
): Promise<void> {
  const hasPermission = await checkUserBranchPermission(userId, branchId, permission);
  
  if (!hasPermission) {
    throw new Error(`User does not have ${permission} permission for this branch`);
  }
}

/**
 * Get branch IDs user can access (for filtering queries)
 */
export async function getUserAccessibleBranchIds(userId: string): Promise<string[]> {
  const branches = await getUserBranches(userId);
  return branches.map(b => b.branch_id);
}
