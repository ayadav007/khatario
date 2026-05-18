import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { GSTR9Generator, GSTR9Filters } from '@/lib/gst/gstr9';
import { generateGSTR9CSVZip } from '@/lib/export/gstr9-csv';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const financial_year = searchParams.get('financial_year');
    const format = searchParams.get('format') || 'json';
    const overridesRaw = searchParams.get('overrides');
    let overrides = {};
    if (overridesRaw) {
      try {
        overrides = JSON.parse(overridesRaw);
      } catch (e) {
        console.error('Failed to parse overrides:', e);
      }
    }
    
    if (!business_id || !financial_year) {
      return NextResponse.json(
        { error: 'business_id and financial_year are required' },
        { status: 400 }
      );
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

    // Determine action based on format (CSV is export)
    const action = format === 'csv' ? 'export' : 'read';

    // AUTHORIZATION: Check read/export permission for GST report
    try {
      await authorize(userId, 'report.gst', action, {
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

    const fy = parseInt(financial_year);
    if (isNaN(fy) || fy < 2017 || fy > 2099) {
      return NextResponse.json(
        { error: 'Invalid financial_year. Expected format: YYYY (e.g., 2024 for FY 2024-25)' },
        { status: 400 }
      );
    }
    
    const filters: GSTR9Filters = {
      business_id,
      financial_year: fy
    };
    
    const generator = new GSTR9Generator();
    const data = await generator.generate(filters, overrides);
    
    if (format === 'csv') {
      const csvBuffer = await generateGSTR9CSVZip(data);
      const filename = `GSTR9_${financial_year}_${filters.business_id.slice(0, 8)}.zip`;
      
      return new NextResponse(csvBuffer as any, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('GSTR-9 Generation Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate GSTR-9', details: error.message },
      { status: 500 }
    );
  }
}
