import { NextRequest, NextResponse } from 'next/server';
import {
  calculateDepreciationForAllAssets,
  saveDepreciationSchedule,
  getTotalDepreciation,
} from '@/lib/services/depreciation-calculator';

/**
 * POST /api/depreciation/calculate
 * Calculate depreciation for all assets or a specific asset
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      financial_year,
      period_start_date,
      period_end_date,
      asset_id,
      manual_amount,
      post_to_ledger = false,
    } = body;

    if (!business_id || !financial_year || !period_start_date || !period_end_date) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (asset_id) {
      // Calculate for single asset
      const { calculateDepreciation } = await import('@/lib/services/depreciation-calculator');
      const calculation = await calculateDepreciation(
        asset_id,
        financial_year,
        period_start_date,
        period_end_date,
        manual_amount
      );

      if (!calculation) {
        return NextResponse.json(
          { error: 'Asset not found or disposed' },
          { status: 404 }
        );
      }

      // Save to schedule
      const scheduleId = await saveDepreciationSchedule(
        calculation,
        business_id,
        post_to_ledger
      );

      return NextResponse.json({
        calculation,
        schedule_id: scheduleId,
        posted: post_to_ledger,
      });
    } else {
      // Calculate for all assets
      const calculations = await calculateDepreciationForAllAssets(
        business_id,
        financial_year,
        period_start_date,
        period_end_date
      );

      // Save all to schedule
      const saved = [];
      for (const calc of calculations) {
        const scheduleId = await saveDepreciationSchedule(
          calc,
          business_id,
          post_to_ledger
        );
        saved.push({ calculation: calc, schedule_id: scheduleId });
      }

      const total = calculations.reduce(
        (sum, calc) => sum + calc.depreciation_amount,
        0
      );

      return NextResponse.json({
        calculations: saved,
        total_depreciation: total,
        assets_count: calculations.length,
      });
    }
  } catch (error: any) {
    console.error('Error calculating depreciation:', error);
    return NextResponse.json(
      { error: 'Failed to calculate depreciation', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/depreciation/calculate
 * Get total depreciation for a financial year
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const financialYear = searchParams.get('financial_year');

    if (!businessId || !financialYear) {
      return NextResponse.json(
        { error: 'business_id and financial_year are required' },
        { status: 400 }
      );
    }

    const total = await getTotalDepreciation(businessId, financialYear);

    return NextResponse.json({ total_depreciation: total });
  } catch (error: any) {
    console.error('Error fetching depreciation:', error);
    return NextResponse.json(
      { error: 'Failed to fetch depreciation', details: error.message },
      { status: 500 }
    );
  }
}

