import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { queryRows, queryOne, getPool } from '@/lib/db';
import { assertPaidPlan, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/period-locks
 * Get period locks for a business/branch
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchId = searchParams.get('branch_id'); // Optional: filter by branch
    const financialYear = searchParams.get('financial_year'); // Optional: filter by financial year

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

    // AUTHORIZATION: Check read permission (PBAC will check business ownership)
    try {
      await authorize(userId, 'accounting_period', 'read', {
        businessId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let sql = `
      SELECT 
        pl.*,
        u.name as locked_by_name,
        b.name as branch_name
      FROM period_locks pl
      LEFT JOIN users u ON pl.locked_by = u.id
      LEFT JOIN branches b ON pl.branch_id = b.id
      WHERE pl.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIdx = 2;

    if (branchId) {
      sql += ` AND (pl.branch_id = $${paramIdx} OR pl.branch_id IS NULL)`;
      params.push(branchId);
      paramIdx++;
    }

    if (financialYear) {
      sql += ` AND pl.financial_year = $${paramIdx}`;
      params.push(financialYear);
      paramIdx++;
    }

    sql += ` ORDER BY pl.period_start DESC, pl.created_at DESC`;

    const locks = await queryRows(sql, params);

    return NextResponse.json({ locks });
  } catch (error: any) {
    console.error('Error fetching period locks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch period locks', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/period-locks
 * Create or update a period lock
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const business_id = getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request, body);
    const {
      branch_id, // Optional: NULL for business-wide lock
      financial_year,
      period_start,
      period_end,
      is_locked,
      notes,
      locked_by,
    } = body;

    if (!business_id || !financial_year || !period_start || !period_end) {
      return NextResponse.json(
        { error: 'business_id, financial_year, period_start, and period_end are required' },
        { status: 400 }
      );
    }

    const userId = getUserIdFromRequest(request, body) || locked_by;
    if (!userId) {
      return NextResponse.json(
        { error: 'locked_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    if (new Date(period_start) > new Date(period_end)) {
      return NextResponse.json(
        { error: 'period_start must be before or equal to period_end' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertPaidPlan(business_id, 'period_lock');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Determine action based on is_locked value
    const action = is_locked !== false ? 'lock' : 'unlock';

    // AUTHORIZATION: Check lock/unlock permission (PBAC will check business ownership, period validation)
    try {
      await authorize(userId, 'accounting_period', action, {
        businessId: business_id,
        branchId: branch_id || null,
        period_start: period_start,
        period_end: period_end,
        resource: {
          business_id,
          branch_id: branch_id || null,
          period_start,
          period_end,
          is_locked: is_locked !== false,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Validate branch if provided
    if (branch_id) {
      const branchCheck = await queryOne(`
        SELECT id, is_active FROM branches 
        WHERE id = $1 AND business_id = $2
      `, [branch_id, business_id]);
      
      if (!branchCheck) {
        return NextResponse.json(
          { error: 'Invalid branch_id. Branch not found or does not belong to this business.' },
          { status: 400 }
        );
      }
    }

    const locking = action === 'lock';
    const keyParams = [business_id, branch_id || null, financial_year, period_start, period_end];

    if (locking) {
      const overlappingLock = await queryOne(`
        SELECT id FROM period_locks
        WHERE business_id = $1
          AND (branch_id = $2 OR branch_id IS NULL OR $2 IS NULL)
          AND financial_year = $3
          AND period_start <= $5::date AND period_end >= $4::date
          AND is_locked = true
      `, keyParams);

      if (overlappingLock) {
        return NextResponse.json(
          { error: 'Overlapping period lock already exists for this period' },
          { status: 400 }
        );
      }
    }

    // branch_id is NULL for business-wide locks and NULLs never collide in the unique
    // key, so match rows explicitly instead of relying on ON CONFLICT.
    const updated = await queryOne(`
      UPDATE period_locks
         SET is_locked = $6,
             locked_by = $7,
             notes = COALESCE($8, notes),
             locked_at = CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE locked_at END,
             updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1
         AND branch_id IS NOT DISTINCT FROM $2::uuid
         AND financial_year = $3
         AND period_start = $4::date
         AND period_end = $5::date
      RETURNING *
    `, [...keyParams, locking, userId, notes || null]);

    if (updated) {
      return NextResponse.json({ lock: updated });
    }
    if (!locking) {
      return NextResponse.json({ error: 'No lock exists for this period' }, { status: 404 });
    }

    const lock = await queryOne(`
      INSERT INTO period_locks (
        business_id, branch_id, financial_year, period_start, period_end,
        is_locked, locked_by, notes
      )
      VALUES ($1, $2, $3, $4, $5, true, $6, $7)
      RETURNING *
    `, [...keyParams, userId, notes || null]);

    return NextResponse.json({ lock }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating/updating period lock:', error);
    return NextResponse.json(
      { error: 'Failed to create/update period lock', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/period-locks
 * Unlock a period (soft delete by setting is_locked = false)
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lockId = searchParams.get('id');
    const userId = getUserIdFromRequest(request);

    if (!lockId || !UUID_RE.test(lockId)) {
      return NextResponse.json(
        { error: 'A valid lock id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // Fetch period lock for authorization
    const scopedBusinessId = getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);
    const existingLock = await queryOne(`
      SELECT * FROM period_locks WHERE id = $1 AND ($2::uuid IS NULL OR business_id = $2::uuid)
    `, [lockId, scopedBusinessId || null]);

    if (!existingLock) {
      return NextResponse.json(
        { error: 'Period lock not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check unlock permission (PBAC will check business ownership, period validation)
    try {
      await authorize(userId, 'accounting_period', 'unlock', {
        businessId: existingLock.business_id,
        branchId: existingLock.branch_id || null,
        period_start: existingLock.period_start,
        period_end: existingLock.period_end,
        resource: existingLock,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const lock = await queryOne(`
      UPDATE period_locks
      SET is_locked = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [lockId]);

    if (!lock) {
      return NextResponse.json(
        { error: 'Period lock not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ lock });
  } catch (error: any) {
    console.error('Error unlocking period:', error);
    return NextResponse.json(
      { error: 'Failed to unlock period', details: error.message },
      { status: 500 }
    );
  }
}
