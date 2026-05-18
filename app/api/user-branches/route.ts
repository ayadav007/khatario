import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { checkUserBranchAccess, getUserBranches } from '@/lib/branch-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';

/**
 * GET /api/user-branches
 * Get all branches a user can access, OR get all user-branch assignments for a business
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    const businessId = getBusinessIdFromRequest(request);

    // If business_id is provided, return all user-branch assignments for that business
    if (businessId) {
      // Authorization: Check if user has settings.read permission
      if (userId) {
        try {
          await authorize(userId, 'settings', 'read', { businessId });
        } catch (error: any) {
          console.error('Authorization error in GET /api/user-branches:', error);
          if (error instanceof AuthorizationError) {
            return error.toNextResponse();
          }
          // Re-throw non-AuthorizationError to be caught by outer try-catch
          throw error;
        }
      }

      const assignments = await db.queryRows(`
        SELECT 
          CONCAT(ub.user_id::text, '-', ub.branch_id::text) as id,
          ub.user_id,
          u.name as user_name,
          u.email as user_email,
          ub.branch_id,
          b.name as branch_name,
          ub.can_view,
          ub.can_edit,
          ub.can_delete,
          ub.can_create_transactions,
          ub.created_at,
          ub.updated_at,
          CASE 
            WHEN ub.can_view = true OR ub.can_edit = true OR ub.can_delete = true OR ub.can_create_transactions = true 
            THEN true 
            ELSE false 
          END as is_active
        FROM user_branches ub
        JOIN users u ON ub.user_id = u.id
        JOIN branches b ON ub.branch_id = b.id
        WHERE u.business_id = $1 AND b.business_id = $1
        ORDER BY u.name, b.name
      `, [businessId]);

      // Build permissions array in JavaScript instead of SQL
      const assignmentsWithPermissions = (assignments || []).map((assignment: any) => {
        const permissions: string[] = [];
        if (assignment.can_create_transactions) permissions.push('create_transactions');
        if (assignment.can_view) permissions.push('view_reports');
        if (assignment.can_edit) permissions.push('manage_inventory');
        
        return {
          ...assignment,
          permissions
        };
      });

      return NextResponse.json({ assignments: assignmentsWithPermissions });
    }

    // Otherwise, require user_id and return branches for that user
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id or business_id is required' },
        { status: 400 }
      );
    }

    const branches = await getUserBranches(userId);

    return NextResponse.json({ branches });
  } catch (error: any) {
    console.error('Error in GET /api/user-branches:', error);
    console.error('Error name:', error?.name);
    console.error('Error message:', error?.message);
    console.error('Error stack:', error?.stack);
    
    // If it's an AuthorizationError, return it properly
    if (error instanceof AuthorizationError) {
      return error.toNextResponse();
    }
    
    return NextResponse.json(
      { error: 'Failed to fetch user branches', details: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user-branches
 * Assign user to branch with permissions
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      user_id,
      branch_id,
      permissions, // Array of permission strings: ['create_transactions', 'view_reports', 'manage_inventory']
      can_view, // Legacy: boolean flag
      can_edit, // Legacy: boolean flag
      can_delete, // Legacy: boolean flag
      can_create_transactions, // Legacy: boolean flag
    } = body;

    const business_id = getBusinessIdFromRequest(request, body); // Optional: for authorization

    if (!user_id || !branch_id) {
      return NextResponse.json(
        { error: 'user_id and branch_id are required' },
        { status: 400 }
      );
    }

    // Authorization: Check if user has settings.create permission
    const authUserId = resolveCreatedByUserId(request, body);
    if (business_id && !authUserId) {
      return NextResponse.json(
        { error: 'created_by_user_id is required for authorization' },
        { status: 400 }
      );
    }
    if (business_id) {
      try {
        await authorize(authUserId!, 'settings', 'create', { businessId: business_id });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return error.toNextResponse();
        }
        throw error;
      }
    }

    // Map permissions array to boolean flags if permissions array is provided
    let finalCanView = can_view;
    let finalCanEdit = can_edit;
    let finalCanDelete = can_delete;
    let finalCanCreateTransactions = can_create_transactions;

    if (permissions && Array.isArray(permissions)) {
      // Map permission strings to boolean flags
      finalCanCreateTransactions = permissions.includes('create_transactions');
      finalCanView = permissions.includes('view_reports') || permissions.includes('view');
      finalCanEdit = permissions.includes('manage_inventory') || permissions.includes('edit');
      finalCanDelete = permissions.includes('delete');
    } else {
      // Use defaults if neither permissions array nor individual flags are provided
      finalCanView = can_view !== undefined ? can_view : true;
      finalCanEdit = can_edit !== undefined ? can_edit : false;
      finalCanDelete = can_delete !== undefined ? can_delete : false;
      finalCanCreateTransactions = can_create_transactions !== undefined ? can_create_transactions : false;
    }

    // Verify user and branch belong to same business
    const user = await db.queryOne<{ business_id: string }>(`
      SELECT business_id FROM users WHERE id = $1
    `, [user_id]);

    const branch = await db.queryOne<{ business_id: string }>(`
      SELECT business_id FROM branches WHERE id = $1
    `, [branch_id]);

    if (!user || !branch) {
      return NextResponse.json(
        { error: 'User or branch not found' },
        { status: 404 }
      );
    }

    if (user.business_id !== branch.business_id) {
      return NextResponse.json(
        { error: 'User and branch must belong to the same business' },
        { status: 400 }
      );
    }

    // Insert or update user-branch access
    const access = await db.queryOne(`
      INSERT INTO user_branches (
        user_id, branch_id, can_view, can_edit, can_delete, can_create_transactions
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, branch_id)
      DO UPDATE SET
        can_view = EXCLUDED.can_view,
        can_edit = EXCLUDED.can_edit,
        can_delete = EXCLUDED.can_delete,
        can_create_transactions = EXCLUDED.can_create_transactions,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [user_id, branch_id, finalCanView, finalCanEdit, finalCanDelete, finalCanCreateTransactions]);

    return NextResponse.json({ access }, { status: 201 });
  } catch (error: any) {
    console.error('Error assigning user to branch:', error);
    return NextResponse.json(
      { error: 'Failed to assign user to branch', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/user-branches
 * Remove user from branch
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    const branchId = searchParams.get('branch_id');
    const assignmentId = searchParams.get('id'); // Support deletion by assignment ID

    if (assignmentId) {
      // Delete by assignment ID (format: "user_id-branch_id")
      const [userIdFromId, branchIdFromId] = assignmentId.split('-');
      if (!userIdFromId || !branchIdFromId) {
        return NextResponse.json(
          { error: 'Invalid assignment ID format' },
          { status: 400 }
        );
      }
      await db.query(`
        DELETE FROM user_branches
        WHERE user_id = $1 AND branch_id = $2
      `, [userIdFromId, branchIdFromId]);

      return NextResponse.json({ success: true });
    }

    if (!userId || !branchId) {
      return NextResponse.json(
        { error: 'user_id and branch_id, or id is required' },
        { status: 400 }
      );
    }

    await db.query(`
      DELETE FROM user_branches
      WHERE user_id = $1 AND branch_id = $2
    `, [userId, branchId]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error removing user from branch:', error);
    return NextResponse.json(
      { error: 'Failed to remove user from branch', details: error.message },
      { status: 500 }
    );
  }
}
