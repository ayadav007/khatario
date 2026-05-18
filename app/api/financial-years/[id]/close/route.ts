import { NextRequest, NextResponse } from 'next/server';
import { executeYearClosing, validateYearClosing } from '@/lib/services/year-closing';
import { queryOne } from '@/lib/db';

/**
 * POST /api/financial-years/[id]/close
 * Execute year closing process
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { business_id, tax_rate, user_id } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Get financial year details
    const financialYear = await queryOne<{
      id: string;
      year_code: string;
      start_date: string;
      end_date: string;
    }>(
      `SELECT id, year_code, start_date, end_date
       FROM financial_years
       WHERE id = $1 AND business_id = $2`,
      [params.id, business_id]
    );

    if (!financialYear) {
      return NextResponse.json(
        { error: 'Financial year not found' },
        { status: 404 }
      );
    }

    // Validate prerequisites
    const validation = await validateYearClosing(business_id, financialYear.year_code);
    
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: 'Year closing validation failed',
          errors: validation.errors,
          warnings: validation.warnings,
        },
        { status: 400 }
      );
    }

    // Execute year closing
    const result = await executeYearClosing(
      business_id,
      financialYear.id,
      financialYear.year_code,
      financialYear.start_date,
      financialYear.end_date,
      user_id || null,
      tax_rate || 30
    );

    return NextResponse.json({
      success: true,
      result,
      warnings: validation.warnings,
    });
  } catch (error: any) {
    console.error('Error executing year closing:', error);
    return NextResponse.json(
      { error: 'Failed to execute year closing', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/financial-years/[id]/close
 * Validate year closing prerequisites
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const financialYear = await queryOne<{ year_code: string }>(
      `SELECT year_code FROM financial_years WHERE id = $1 AND business_id = $2`,
      [params.id, businessId]
    );

    if (!financialYear) {
      return NextResponse.json(
        { error: 'Financial year not found' },
        { status: 404 }
      );
    }

    const validation = await validateYearClosing(businessId, financialYear.year_code);

    return NextResponse.json(validation);
  } catch (error: any) {
    console.error('Error validating year closing:', error);
    return NextResponse.json(
      { error: 'Failed to validate year closing', details: error.message },
      { status: 500 }
    );
  }
}
