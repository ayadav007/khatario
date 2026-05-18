import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows, queryOne, getPool } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

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
    const {
      business_id,
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

    const userId = locked_by || getUserIdFromRequest(request, body);
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
      await assertFeatureAccess(business_id, 'advanced');
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

    // Check for overlapping locks
    const overlappingLock = await queryOne(`
      SELECT id FROM period_locks
      WHERE business_id = $1
        AND (branch_id = $2 OR branch_id IS NULL OR $2 IS NULL)
        AND financial_year = $3
        AND (
          (period_start <= $4 AND period_end >= $4) OR
          (period_start <= $5 AND period_end >= $5) OR
          (period_start >= $4 AND period_end <= $5)
        )
        AND is_locked = true
    `, [business_id, branch_id || null, financial_year, period_start, period_end]);

    if (overlappingLock) {
      return NextResponse.json(
        { error: 'Overlapping period lock already exists for this period' },
        { status: 400 }
      );
    }

    // Insert or update period lock
    const lock = await queryOne(`
      INSERT INTO period_locks (
        business_id, branch_id, financial_year, period_start, period_end,
        is_locked, locked_by, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (business_id, branch_id, financial_year, period_start, period_end)
      DO UPDATE SET
        is_locked = EXCLUDED.is_locked,
        locked_by = EXCLUDED.locked_by,
        notes = EXCLUDED.notes,
        locked_at = CASE WHEN EXCLUDED.is_locked THEN CURRENT_TIMESTAMP ELSE locked_at END,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      business_id,
      branch_id || null,
      financial_year,
      period_start,
      period_end,
      is_locked !== undefined ? is_locked : true,
      locked_by || null,
      notes || null,
    ]);

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

    if (!lockId) {
      return NextResponse.json(
        { error: 'id is required' },
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
    const existingLock = await queryOne(`
      SELECT * FROM period_locks WHERE id = $1
    `, [lockId]);

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
