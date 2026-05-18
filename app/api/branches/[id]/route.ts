import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { normalizePhoneOrNull } from '@/lib/utils/phone';

/**
 * GET /api/branches/[id]
 * Get a specific branch
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const businessId = getBusinessIdFromRequest(request);

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const branch = await db.queryOne(`
      SELECT * FROM branches
      WHERE id = $1 AND business_id = $2
    `, [params.id, businessId]);

    if (!branch) {
      return NextResponse.json(
        { error: 'Branch not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ branch });
  } catch (error: any) {
    console.error('Error fetching branch:', error);
    return NextResponse.json(
      { error: 'Failed to fetch branch', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/branches/[id]
 * Update a branch
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const business_id = getBusinessIdFromRequest(request, body);
    const {
      name,
      branch_code,
      gstin,
      address_line1,
      address_line2,
      city,
      state,
      state_code,
      pincode,
      country,
      phone,
      email,
      branch_type,
      is_primary,
      is_default,
      invoice_prefix,
      is_active,
    } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const { updated_by_user_id } = body; // REQUIRED for authorization
    if (!updated_by_user_id) {
      return NextResponse.json(
        { error: 'updated_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check update permission
    // First check if user has branch-level edit permission
    const { checkUserBranchPermission } = await import('@/lib/branch-access');
    const hasBranchEditPermission = await checkUserBranchPermission(updated_by_user_id, params.id, 'edit');
    
    // If user doesn't have branch-level edit permission, check settings.update permission
    if (!hasBranchEditPermission) {
      try {
        await authorize(updated_by_user_id, 'settings', 'update', { businessId: business_id, resourceId: params.id });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return error.toNextResponse();
        }
        throw error;
      }
    }

    // Subscription: multi_branch is required only when editing a non-default branch while
    // multiple active branches exist. Single-outlet (or default / HQ branch) edits stay allowed on Free.
    const currentBranch = await db.queryOne<{ is_default: boolean }>(
      `SELECT is_default FROM branches WHERE id = $1 AND business_id = $2`,
      [params.id, business_id]
    );

    if (!currentBranch) {
      return NextResponse.json(
        { error: 'Branch not found' },
        { status: 404 }
      );
    }

    const activeCountRow = await db.queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM branches WHERE business_id = $1 AND is_active = true`,
      [business_id]
    );
    const activeBranchCount = parseInt(activeCountRow?.n || '0', 10);
    const requiresMultiBranch = activeBranchCount > 1 && !currentBranch.is_default;

    if (requiresMultiBranch) {
      try {
        await assertFeatureAccess(business_id, 'multi_branch');
      } catch (error) {
        if (error instanceof FeatureAccessDeniedError) {
          return error.toNextResponse();
        }
        throw error;
      }
    }

    // If setting as default, unset other default branches
    // CRITICAL: Ensure exactly one default branch per business
    if (is_default === true) {
      await db.query(`
        UPDATE branches 
        SET is_default = false 
        WHERE business_id = $1 AND id != $2 AND is_default = true
      `, [business_id, params.id]);
    } else if (is_default === false && currentBranch.is_default) {
      // Prevent unsetting default if it's the only default
      const otherDefaultCount = await db.queryOne<{ count: number }>(`
        SELECT COUNT(*) as count
        FROM branches
        WHERE business_id = $1 AND id != $2 AND is_default = true AND is_active = true
      `, [business_id, params.id]);

      if (otherDefaultCount?.count === 0) {
        return NextResponse.json(
          {
            error: 'Cannot unset default branch',
            code: 'MUST_HAVE_ONE_DEFAULT',
            details: 'Every business must have exactly one default branch. Set another branch as default before unsetting this one.'
          },
          { status: 400 }
        );
      }
    }

    // If setting as primary, unset other primary branches
    if (is_primary) {
      await db.query(`
        UPDATE branches 
        SET is_primary = false 
        WHERE business_id = $1 AND id != $2
      `, [business_id, params.id]);
    }

    const phoneNorm = phone !== undefined ? normalizePhoneOrNull(phone) : undefined;

    const branch = await db.queryOne(`
      UPDATE branches SET
        name = COALESCE($3, name),
        branch_code = COALESCE($4, branch_code),
        gstin = COALESCE($5, gstin),
        address_line1 = COALESCE($6, address_line1),
        address_line2 = COALESCE($7, address_line2),
        city = COALESCE($8, city),
        state = COALESCE($9, state),
        state_code = COALESCE($10, state_code),
        pincode = COALESCE($11, pincode),
        country = COALESCE($12, country),
        phone = COALESCE($13, phone),
        email = COALESCE($14, email),
        branch_type = COALESCE($15, branch_type),
        is_primary = COALESCE($16, is_primary),
        is_default = COALESCE($17, is_default),
        invoice_prefix = COALESCE($18, invoice_prefix),
        is_active = COALESCE($19, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2
      RETURNING *
    `, [
      params.id,
      business_id,
      name,
      branch_code,
      gstin,
      address_line1,
      address_line2,
      city,
      state,
      state_code,
      pincode,
      country,
      phoneNorm,
      email,
      branch_type,
      is_primary,
      is_default,
      invoice_prefix,
      is_active,
    ]);

    if (!branch) {
      return NextResponse.json(
        { error: 'Branch not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ branch });
  } catch (error: any) {
    console.error('Error updating branch:', error);
    return NextResponse.json(
      { error: 'Failed to update branch', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/branches/[id]
 * Delete a branch
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check delete permission (branches are part of settings)
    try {
      await authorize(userId, 'settings', 'delete', { businessId, resourceId: params.id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Removing an extra (non-default) branch is allowed without multi_branch so businesses
    // can consolidate outlets. Creating additional branches still requires the feature (POST).

    // Check if branch is default branch (cannot be deleted)
    const branch = await db.queryOne(`
      SELECT is_default, is_primary FROM branches
      WHERE id = $1 AND business_id = $2
    `, [params.id, businessId]);

    if (!branch) {
      return NextResponse.json(
        { error: 'Branch not found' },
        { status: 404 }
      );
    }

    // CRITICAL: Prevent deletion of default branch
    if (branch.is_default) {
      return NextResponse.json(
        {
          error: 'Cannot delete default branch',
          code: 'DEFAULT_BRANCH_CANNOT_BE_DELETED',
          details: 'Every business must have exactly one default branch. To delete this branch, first set another branch as the default branch, then delete this one.'
        },
        { status: 400 }
      );
    }

    // Check if branch has transactions
    const hasTransactions = await db.queryOne(`
      SELECT EXISTS(
        SELECT 1 FROM invoices WHERE branch_id = $1
        UNION ALL
        SELECT 1 FROM purchases WHERE branch_id = $1
        UNION ALL
        SELECT 1 FROM credit_notes WHERE branch_id = $1
        UNION ALL
        SELECT 1 FROM payments WHERE branch_id = $1
        UNION ALL
        SELECT 1 FROM expenses WHERE branch_id = $1
        UNION ALL
        SELECT 1 FROM ledger_entry_lines WHERE branch_id = $1
      ) as has_transactions
    `, [params.id]);

    if (hasTransactions?.has_transactions) {
      return NextResponse.json(
        { error: 'Cannot delete branch with existing transactions. Deactivate the branch instead.' },
        { status: 400 }
      );
    }

    await db.query(`
      DELETE FROM branches
      WHERE id = $1 AND business_id = $2
    `, [params.id, businessId]);

    return NextResponse.json({ message: 'Branch deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting branch:', error);
    return NextResponse.json(
      { error: 'Failed to delete branch', details: error.message },
      { status: 500 }
    );
  }
}
