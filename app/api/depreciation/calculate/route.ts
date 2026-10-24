export const dynamic = 'force-dynamic';

import { requireTenantBusinessId } from '@/lib/auth-helpers';

import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { guardLedgerRoute } from '@/lib/http/ledger-route-guard';
import {
  calculateDepreciationForAllAssets,
  saveDepreciationSchedule,
  getTotalDepreciation,
  DepreciationOverlapError,
} from '@/lib/services/depreciation-calculator';

/**
 * POST /api/depreciation/calculate
 * Calculate depreciation for all assets or a specific asset
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      financial_year,
      period_start_date,
      period_end_date,
      asset_id,
      manual_amount,
      post_to_ledger = false,
    } = body;

    if (!body.business_id || !financial_year || !period_start_date || !period_end_date) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const guard = await guardLedgerRoute(request, {
      claimedBusinessId: body.business_id,
      branchId: body.branch_id,
      action: 'create',
      dates: post_to_ledger ? [period_end_date] : [],
      actionLabel: 'post depreciation',
    });
    if (!guard.ok) return guard.response;
    const business_id = guard.businessId;

    if (asset_id) {
      const owned = await queryOne<{ id: string }>(
        'SELECT id FROM fixed_assets WHERE id = $1 AND business_id = $2',
        [asset_id, business_id]
      );
      if (!owned) {
        return NextResponse.json({ error: 'Asset not found or disposed' }, { status: 404 });
      }
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

      const saved = [];
      const skipped: Array<{ asset_id: string; asset_name: string; reason: string }> = [];
      for (const calc of calculations) {
        try {
          const scheduleId = await saveDepreciationSchedule(calc, business_id, post_to_ledger);
          saved.push({ calculation: calc, schedule_id: scheduleId });
        } catch (err) {
          if (!(err instanceof DepreciationOverlapError)) throw err;
          skipped.push({ asset_id: calc.asset_id, asset_name: calc.asset_name, reason: err.message });
        }
      }

      const total = saved.reduce(
        (sum, s) => sum + s.calculation.depreciation_amount,
        0
      );

      return NextResponse.json({
        calculations: saved,
        skipped,
        total_depreciation: total,
        assets_count: saved.length,
      });
    }
  } catch (error: any) {
    if (error instanceof DepreciationOverlapError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
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
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;
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

