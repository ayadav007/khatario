import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  getAuthenticatedUserId,
  getSessionScopedBusinessId,
} from '@/lib/auth-helpers';
import { normalizePhoneOrNull } from '@/lib/utils/phone';
import { resolveGstinAndState } from '@/lib/tax/gstin';
import { panFromGstin } from '@/lib/tax/pan';
import { branchOutsideRegistrationState, stateCodeFromName } from '@/lib/gst/registration';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';

export const dynamic = 'force-dynamic';

/** True when any GST document (invoice, note, purchase, expense, challan) was issued under this branch. */
async function branchHasGstDocuments(branchId: string): Promise<boolean> {
  const row = await db.queryOne<{ has_docs: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM invoices WHERE branch_id = $1)
         OR EXISTS (SELECT 1 FROM credit_notes WHERE branch_id = $1)
         OR EXISTS (SELECT 1 FROM debit_notes WHERE branch_id = $1)
         OR EXISTS (SELECT 1 FROM purchases WHERE branch_id = $1)
         OR EXISTS (SELECT 1 FROM expenses WHERE branch_id = $1)
         OR EXISTS (SELECT 1 FROM delivery_challans WHERE branch_id = $1) AS has_docs`,
    [branchId]
  );
  return !!row?.has_docs;
}

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
    const business_id = getSessionScopedBusinessId(request);
    const userId = getAuthenticatedUserId(request);
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

    if (!business_id || !userId) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }

    const currentBranch = await db.queryOne<{
      is_default: boolean;
      is_active: boolean;
      is_primary: boolean;
      gstin: string | null;
      state: string | null;
      state_code: string | null;
      invoice_prefix: string | null;
    }>(
      `SELECT is_default, COALESCE(is_active, true) AS is_active, COALESCE(is_primary, false) AS is_primary,
              gstin, state, state_code, invoice_prefix
         FROM branches WHERE id = $1 AND business_id = $2`,
      [params.id, business_id]
    );

    if (!currentBranch) {
      return NextResponse.json(
        { error: 'Branch not found' },
        { status: 404 }
      );
    }

    const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : v == null ? '' : String(v));
    const gstinChanges = gstin !== undefined && norm(gstin) !== norm(currentBranch.gstin);
    const codeOf = (code: unknown, name: unknown) =>
      (typeof code === 'string' && code.trim() ? code.trim().padStart(2, '0') : null) ?? stateCodeFromName(name as string | null);
    const stateChanges =
      (state !== undefined || state_code !== undefined) &&
      codeOf(state_code ?? (state !== undefined ? null : currentBranch.state_code), state ?? currentBranch.state) !==
        codeOf(currentBranch.state_code, currentBranch.state);
    const flagChanges =
      (is_active !== undefined && !!is_active !== currentBranch.is_active) ||
      (is_default !== undefined && !!is_default !== currentBranch.is_default) ||
      (is_primary !== undefined && !!is_primary !== currentBranch.is_primary) ||
      (invoice_prefix !== undefined && norm(invoice_prefix) !== norm(currentBranch.invoice_prefix));

    // AUTHORIZATION: branch-level edit covers address and contact details only. Changing the GST
    // registration (GSTIN, state), the default/active flags or the invoice prefix always needs
    // settings.update: any user is auto-granted edit on the default branch (lib/branch-access.ts).
    const { checkUserBranchPermission } = await import('@/lib/branch-access');
    const hasBranchEditPermission =
      !(gstinChanges || stateChanges || flagChanges) && (await checkUserBranchPermission(userId, params.id, 'edit'));
    if (!hasBranchEditPermission) {
      try {
        await authorize(userId, 'settings', 'update', { businessId: business_id, resourceId: params.id });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return error.toNextResponse();
        }
        throw error;
      }
    }

    // The default branch is where documents without a branch are issued; deactivating it would hand
    // that role to whichever branch is oldest, possibly on another GSTIN.
    if (is_active === false && currentBranch.is_default) {
      return NextResponse.json(
        {
          error: 'This is the default branch. Make another branch the default before deactivating it.',
          code: 'DEFAULT_BRANCH_DEACTIVATE',
        },
        { status: 400 }
      );
    }

    // Reactivating counts against the plan's branch limit, like creating one.
    if (is_active === true && !currentBranch.is_active) {
      try {
        await enforceAccess({
          businessId: business_id,
          userId,
          feature: FeatureKeys.MULTI_BRANCH,
          limitType: 'branches',
        });
      } catch (e) {
        const res = enforceAccessErrorResponse(e);
        if (res) return res;
        throw e;
      }
    }

    // Documents keep the registration they were issued under, and invoices read it from the branch
    // (print, GSTR-1, GSTR-3B). Once a branch has documents its GSTIN and state cannot change.
    if ((gstinChanges || stateChanges) && (await branchHasGstDocuments(params.id))) {
      return NextResponse.json(
        {
          error:
            'This branch already has GST documents, which were issued under its current GSTIN and state. ' +
            'To trade under a different registration, add a new branch with that GSTIN.',
          code: 'BRANCH_REGISTRATION_LOCKED',
        },
        { status: 409 }
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

    let finalGstin = gstin;
    let finalState = state;
    let finalStateCode = state_code;
    if (typeof gstin === 'string' && gstin.trim()) {
      const gstinCheck = resolveGstinAndState({ gstin, state, state_code });
      if (!gstinCheck.ok) {
        return NextResponse.json({ error: gstinCheck.error, code: gstinCheck.code }, { status: 400 });
      }
      const biz = await db.queryOne<{ gstin: string | null }>(`SELECT gstin FROM businesses WHERE id = $1`, [business_id]);
      const bizPan = panFromGstin(biz?.gstin);
      if (bizPan && gstinCheck.pan && bizPan !== gstinCheck.pan) {
        return NextResponse.json(
          { error: `Branch GSTIN must belong to the same PAN as the business (${bizPan}).`, code: 'BRANCH_GSTIN_PAN_MISMATCH' },
          { status: 400 }
        );
      }
      finalGstin = gstinCheck.gstin;
      finalState = gstinCheck.state;
      finalStateCode = gstinCheck.state_code;
    }

    // A branch without its own GSTIN must sit in the business GSTIN's state.
    if (gstin !== undefined || state !== undefined || state_code !== undefined) {
      const cur = await db.queryOne<{ gstin: string | null; state: string | null; state_code: string | null }>(
        `SELECT gstin, state, state_code FROM branches WHERE id = $1 AND business_id = $2`,
        [params.id, business_id]
      );
      const bizReg = await db.queryOne<{ gstin: string | null; state: string | null; state_code: string | null }>(
        `SELECT gstin, state, state_code FROM businesses WHERE id = $1`,
        [business_id]
      );
      const outOfState = branchOutsideRegistrationState(
        {
          gstin: finalGstin ?? cur?.gstin,
          state: finalState ?? cur?.state,
          // A new state name without a code must not be judged against the old code.
          state_code: finalStateCode ?? (finalState != null ? null : cur?.state_code),
        },
        bizReg ?? {}
      );
      if (outOfState) {
        return NextResponse.json({ error: outOfState, code: 'BRANCH_NEEDS_OWN_GSTIN' }, { status: 400 });
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
      finalGstin,
      address_line1,
      address_line2,
      city,
      finalState,
      finalStateCode,
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
