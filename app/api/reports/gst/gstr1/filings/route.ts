import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { getPool } from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');

    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription report access
    try {
      await assertReportAccess(business_id, 'gst');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // CRITICAL: Resolve branch_id using helper (handles default branch fallback)
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam,
        businessId: business_id,
      });
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }
      throw error;
    }

    // AUTHORIZATION: Check read permission for GST report
    try {
      await authorize(userId, 'report.gst', 'read', {
        businessId: business_id,
        branchId: finalBranchId,
        resource: {
          business_id,
          branch_id: finalBranchId,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const pool = getPool();
    const client = await pool.connect();
    
    try {
      const filings = await client.query(
        `SELECT 
          f.id,
          f.filing_period,
          f.filing_date,
          f.status,
          f.lock_date,
          f.created_at,
          f.updated_at,
          f.filed_by,
          u.name as filed_by_name,
          COUNT(DISTINCT fi.invoice_id) as invoice_count,
          (f.gstr1_snapshot IS NOT NULL) AS has_gstr1_snapshot
         FROM gstr1_filings f
         LEFT JOIN gstr1_filing_invoices fi ON f.id = fi.gstr1_filing_id
         LEFT JOIN users u ON f.filed_by = u.id
         WHERE f.business_id = $1
         GROUP BY f.id, f.filing_period, f.filing_date, f.status, f.lock_date, 
                  f.created_at, f.updated_at, f.filed_by, u.name, f.gstr1_snapshot
         ORDER BY f.filing_period DESC, f.created_at DESC`,
        [business_id]
      );

      const rows = filings.rows;
      if (process.env.NODE_ENV === 'development') {
        const legacy = rows.filter((r: any) => r.status === 'filed' && !r.has_gstr1_snapshot);
        if (legacy.length > 0) {
          console.warn(
            `[GSTR-1] ${legacy.length} filing(s) marked filed before gstr1_snapshot existed — use live report or re-mark file after upgrade.`
          );
        }
      }

      return NextResponse.json({ filings: rows });
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error fetching GSTR-1 filings:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

