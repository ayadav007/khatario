import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { getUserIdFromRequest, getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { normalizePhoneOrNull } from '@/lib/utils/phone';
import { resolveGstinAndState } from '@/lib/tax/gstin';
import { panFromGstin } from '@/lib/tax/pan';

export const dynamic = 'force-dynamic';

/**
 * GET /api/branches
 * Fetch all branches for a business
 */
export async function GET(request: NextRequest) {
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

    // CRITICAL SECURITY: Check if user is primary admin first
    const user = await db.queryOne<{ is_primary_admin: boolean }>(
      'SELECT is_primary_admin FROM users WHERE id = $1',
      [userId]
    );

    // Check if user has any branch assignments
    const userBranches = await db.queryRows<{ branch_id: string }>(`
      SELECT branch_id FROM user_branches WHERE user_id = $1
    `, [userId]);

    // SECURITY RULE: 
    // 1. Primary admins always see all branches (unless they have explicit branch assignments - then they see assigned + all)
    // 2. Non-primary-admin users with branch assignments ONLY see their assigned branches (even if they have settings.read)
    // 3. Users without branch assignments need settings.read to see branches
    let branches;
    
    if (user?.is_primary_admin === true) {
      // Primary admin: Return all branches (they can manage all branches)
      branches = await db.queryRows(`
        SELECT * FROM branches
        WHERE business_id = $1
        ORDER BY is_primary DESC, name ASC
      `, [businessId]);
    } else if (userBranches.length > 0) {
      // User has branch assignments: Return ONLY their assigned branches (regardless of settings.read permission)
      // This ensures branch users cannot see branches they're not assigned to
      branches = await db.queryRows(`
        SELECT b.* FROM branches b
        INNER JOIN user_branches ub ON b.id = ub.branch_id
        WHERE ub.user_id = $1 AND b.business_id = $2
        ORDER BY b.is_primary DESC, b.name ASC
      `, [userId, businessId]);
    } else {
      // User has no branch assignments: Check settings.read permission
      try {
        await authorize(userId, 'settings', 'read', { businessId });
        // User has settings.read and no branch assignments - return all branches
        branches = await db.queryRows(`
          SELECT * FROM branches
          WHERE business_id = $1
          ORDER BY is_primary DESC, name ASC
        `, [businessId]);
      } catch (error) {
        if (error instanceof AuthorizationError) {
          // No branch assignments and no settings.read permission - deny access
          return error.toNextResponse();
        }
        throw error;
      }
    }

    return NextResponse.json({ branches });
  } catch (error: any) {
    console.error('Error fetching branches:', error);
    return NextResponse.json(
      { error: 'Failed to fetch branches', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/branches
 * Create a new branch (accounting entity)
 */
export async function POST(request: NextRequest) {
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
    } = body;
    const createdByUserId = resolveCreatedByUserId(request, body);

    if (!business_id || !name) {
      return NextResponse.json(
        { error: 'business_id and name are required' },
        { status: 400 }
      );
    }

    if (!createdByUserId) {
      return NextResponse.json(
        { error: 'created_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check create permission (branches are part of settings)
    try {
      await authorize(createdByUserId, 'settings', 'create', { businessId: business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const existingCountRow = await db.queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM branches WHERE business_id = $1 AND is_active = true`,
      [business_id]
    );
    const existingActiveBranches = parseInt(existingCountRow?.n || '0', 10);
    try {
      await enforceAccess({
        businessId: business_id,
        userId: createdByUserId,
        feature: existingActiveBranches >= 1 ? FeatureKeys.MULTI_BRANCH : undefined,
        limitType: 'branches',
      });
    } catch (e) {
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
    }

    const gstinCheck = resolveGstinAndState({ gstin, state, state_code });
    if (!gstinCheck.ok) {
      return NextResponse.json({ error: gstinCheck.error, code: gstinCheck.code }, { status: 400 });
    }
    if (gstinCheck.pan) {
      const biz = await db.queryOne<{ gstin: string | null }>(`SELECT gstin FROM businesses WHERE id = $1`, [business_id]);
      const bizPan = panFromGstin(biz?.gstin);
      if (bizPan && bizPan !== gstinCheck.pan) {
        return NextResponse.json(
          { error: `Branch GSTIN must belong to the same PAN as the business (${bizPan}).`, code: 'BRANCH_GSTIN_PAN_MISMATCH' },
          { status: 400 }
        );
      }
    }

    // CRITICAL: Handle is_default flag
    // If setting as default, unset other default branches
    // CRITICAL: Ensure exactly one default branch per business
    if (is_default === true) {
      await db.query(`
        UPDATE branches 
        SET is_default = false 
        WHERE business_id = $1 AND is_default = true AND is_active = true
      `, [business_id]);
    }

    // If setting as primary, unset other primary branches
    if (is_primary) {
      await db.query(`
        UPDATE branches 
        SET is_primary = false 
        WHERE business_id = $1
      `, [business_id]);
    }

    const phoneNorm = normalizePhoneOrNull(phone);

    const branch = await db.queryOne(`
      INSERT INTO branches (
        business_id, name, branch_code, gstin, address_line1, address_line2,
        city, state, state_code, pincode, country, phone, email,
        branch_type, is_primary, is_default, invoice_prefix
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `, [
      business_id, name, branch_code, gstinCheck.gstin, address_line1, address_line2,
      city, gstinCheck.state, gstinCheck.state_code, pincode, country || 'India', phoneNorm, email,
      branch_type || 'retail', is_primary || false, is_default || false, invoice_prefix
    ]);

    // Rule 46(b): one consecutive series per GSTIN per year. A second branch on the same
    // GSTIN must not restart at INV-001, so non-default branches get their own prefix.
    if (branch && !is_default) {
      const code =
        String(invoice_prefix || '').trim() ||
        `INV-${(String(branch_code || '').trim() || String(name).replace(/[^A-Za-z0-9]/g, '').slice(0, 3) || 'BR').toUpperCase()}`;
      try {
        await db.query(
          `INSERT INTO branch_document_prefixes (branch_id, document_type, prefix)
           VALUES ($1, 'tax_invoice', $2)
           ON CONFLICT (branch_id, document_type) DO NOTHING`,
          [branch.id, code.slice(0, 50)]
        );
      } catch (error: any) {
        if (error?.code !== '42P01') throw error;
      }
    }

    return NextResponse.json({ branch }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating branch:', error);
    return NextResponse.json(
      { error: 'Failed to create branch', details: error.message },
      { status: 500 }
    );
  }
}
