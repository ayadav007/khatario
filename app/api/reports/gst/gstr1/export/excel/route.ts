import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { GSTR1Generator, GSTR1Filters } from '@/lib/gst/gstr1';
import { generateOfficialGSTR1Excel } from '@/lib/export/gstr1-official-excel';
import { generateGstr1OfflineToolV22Excel } from '@/lib/export/gstr1-offline-tool-v22-excel';
import { getPool } from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/gst/gstr1/export/excel
 * 
 * Exports GSTR-1 as Excel.
 * - Default: Khatario multi-sheet workbook (`generateOfficialGSTR1Excel`).
 * - `?format=offline_v22`: GST Java **offline tool** workbook (loads bundled V2.2 template, fills row 5+).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const excelFormat = searchParams.get('format') || '';
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const branchIdParam = searchParams.get('branch_id'); // Optional: filter by branch
    
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

    // AUTHORIZATION: Check export permission for GST report (PBAC will check branch access, business ownership)
    // Export requires elevated permissions - more restrictive than read
    try {
      await authorize(userId, 'report.gst', 'export', {
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

    const filters: GSTR1Filters = {
      business_id,
      branch_id: finalBranchId,
      month: searchParams.get('month') ? parseInt(searchParams.get('month')!) : undefined,
      year: searchParams.get('year') ? parseInt(searchParams.get('year')!) : undefined,
      from_date: searchParams.get('from_date') || undefined,
      to_date: searchParams.get('to_date') || undefined,
      customer_type: searchParams.get('customer_type') as any
    };

    // Fetch business GSTIN and state code
    const pool = getPool();
    const client = await pool.connect();
    
    try {
      const businessRes = await client.query(
        'SELECT gstin, state_code FROM businesses WHERE id = $1',
        [business_id]
      );
      
      if (businessRes.rows.length === 0) {
        return NextResponse.json(
          { error: 'Business not found' },
          { status: 404 }
        );
      }
      
      const business = businessRes.rows[0];
      
      if (!business.gstin) {
        return NextResponse.json(
          { 
            error: 'Business GSTIN is required for GSTR-1 Excel export',
            message: 'Please set your business GSTIN in Settings → Tax & GST tab before exporting GSTR-1 reports.',
            code: 'GSTIN_MISSING'
          },
          { status: 400 }
        );
      }
      
      // Generate GSTR-1 data
      const generator = new GSTR1Generator();
      const reportData = await generator.generate(filters);
      
      const month = filters.month?.toString().padStart(2, '0') || '';
      const year = filters.year?.toString() || '';

      const excelBuffer =
        excelFormat === 'offline_v22'
          ? await generateGstr1OfflineToolV22Excel(
              reportData,
              filters,
              business.state_code || '',
              business.gstin
            )
          : await generateOfficialGSTR1Excel(
              reportData,
              filters,
              business.state_code || '',
              business.gstin
            );

      const filename =
        excelFormat === 'offline_v22'
          ? `GSTR1_offline_v22_${month}_${year}.xlsx`
          : `GSTR1_${month}_${year}.xlsx`;
      
      return new NextResponse(excelBuffer as any, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
      
    } finally {
      client.release();
    }

  } catch (error: any) {
    console.error('GSTR-1 Excel Export Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to export GSTR-1 Excel file' },
      { status: 500 }
    );
  }
}

