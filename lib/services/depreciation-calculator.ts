/**
 * Depreciation Calculator Service
 * Calculates depreciation using SLM (Straight Line Method) or WDV (Written Down Value)
 * Supports automatic calculation and manual override
 */

import { queryRows, queryOne, getPool } from '@/lib/db';

export type DepreciationMethod = 'SLM' | 'WDV';

export interface DepreciationCalculation {
  asset_id: string;
  asset_code: string;
  asset_name: string;
  financial_year: string;
  period_start_date: string;
  period_end_date: string;
  opening_book_value: number;
  depreciation_amount: number;
  closing_book_value: number;
  method: DepreciationMethod;
  rate: number;
}

/**
 * Calculate depreciation for a single asset for a given period
 */
export async function calculateDepreciation(
  assetId: string,
  financialYear: string,
  periodStartDate: string,
  periodEndDate: string,
  manualAmount?: number
): Promise<DepreciationCalculation | null> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Get asset details
    const asset = await client.query(
      `SELECT 
        id,
        asset_code,
        asset_name,
        purchase_date,
        purchase_cost,
        depreciation_method,
        useful_life_years,
        depreciation_rate,
        residual_value,
        current_book_value,
        accumulated_depreciation,
        is_disposed
      FROM fixed_assets
      WHERE id = $1`,
      [assetId]
    );

    if (asset.rows.length === 0) {
      throw new Error('Asset not found');
    }

    const assetData = asset.rows[0];

    if (assetData.is_disposed) {
      return null; // Skip disposed assets
    }

    // Check if depreciation already calculated for this period
    const existing = await client.query(
      `SELECT * FROM depreciation_schedule
       WHERE asset_id = $1 
         AND financial_year = $2
         AND period_start_date = $3
         AND period_end_date = $4`,
      [assetId, financialYear, periodStartDate, periodEndDate]
    );

    if (existing.rows.length > 0 && existing.rows[0].is_posted) {
      // Return existing calculation
      return {
        asset_id: assetData.id,
        asset_code: assetData.asset_code,
        asset_name: assetData.asset_name,
        financial_year: financialYear,
        period_start_date: periodStartDate,
        period_end_date: periodEndDate,
        opening_book_value: parseFloat(existing.rows[0].opening_book_value),
        depreciation_amount: parseFloat(existing.rows[0].depreciation_amount),
        closing_book_value: parseFloat(existing.rows[0].closing_book_value),
        method: assetData.depreciation_method,
        rate: parseFloat(assetData.depreciation_rate || 0),
      };
    }

    // Get opening book value (from previous period or asset's current book value)
    let openingBookValue = parseFloat(assetData.current_book_value || 0);

    // Check for previous period in same financial year
    const previousPeriod = await client.query(
      `SELECT closing_book_value 
       FROM depreciation_schedule
       WHERE asset_id = $1 
         AND financial_year = $2
         AND period_end_date < $3
       ORDER BY period_end_date DESC
       LIMIT 1`,
      [assetId, financialYear, periodStartDate]
    );

    if (previousPeriod.rows.length > 0) {
      openingBookValue = parseFloat(previousPeriod.rows[0].closing_book_value);
    }

    // Calculate depreciation
    let depreciationAmount = 0;

    if (manualAmount !== undefined && manualAmount !== null) {
      // Manual override
      depreciationAmount = manualAmount;
    } else {
      // Automatic calculation
      depreciationAmount = calculateDepreciationAmount(
        openingBookValue,
        assetData.depreciation_method,
        parseFloat(assetData.depreciation_rate || 0),
        parseFloat(assetData.useful_life_years || 0),
        parseFloat(assetData.residual_value || 0),
        periodStartDate,
        periodEndDate
      );
    }

    // Ensure depreciation doesn't exceed book value minus residual value
    const maxDepreciation = Math.max(0, openingBookValue - parseFloat(assetData.residual_value || 0));
    depreciationAmount = Math.min(depreciationAmount, maxDepreciation);

    const closingBookValue = openingBookValue - depreciationAmount;

    return {
      asset_id: assetData.id,
      asset_code: assetData.asset_code,
      asset_name: assetData.asset_name,
      financial_year: financialYear,
      period_start_date: periodStartDate,
      period_end_date: periodEndDate,
      opening_book_value: openingBookValue,
      depreciation_amount: depreciationAmount,
      closing_book_value: closingBookValue,
      method: assetData.depreciation_method,
      rate: parseFloat(assetData.depreciation_rate || 0),
    };
  } finally {
    client.release();
  }
}

/**
 * Calculate depreciation amount based on method
 */
function calculateDepreciationAmount(
  openingBookValue: number,
  method: DepreciationMethod,
  rate: number,
  usefulLifeYears: number,
  residualValue: number,
  periodStartDate: string,
  periodEndDate: string
): number {
  const startDate = new Date(periodStartDate);
  const endDate = new Date(periodEndDate);
  
  // Calculate number of days in period
  const daysInPeriod = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const daysInYear = 365;
  const periodFraction = daysInPeriod / daysInYear;

  if (method === 'SLM') {
    // Straight Line Method: (Cost - Residual Value) / Useful Life
    const annualDepreciation = (openingBookValue - residualValue) / usefulLifeYears;
    return annualDepreciation * periodFraction;
  } else if (method === 'WDV') {
    // Written Down Value: Opening Book Value * Rate
    const annualDepreciation = openingBookValue * (rate / 100);
    return annualDepreciation * periodFraction;
  }

  return 0;
}

/**
 * Calculate depreciation for all assets for a financial year
 */
export async function calculateDepreciationForAllAssets(
  businessId: string,
  financialYear: string,
  periodStartDate: string,
  periodEndDate: string
): Promise<DepreciationCalculation[]> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Get all active, non-disposed assets
    const assets = await client.query(
      `SELECT id FROM fixed_assets
       WHERE business_id = $1 
         AND is_disposed = false
       ORDER BY asset_code`,
      [businessId]
    );

    const calculations: DepreciationCalculation[] = [];

    for (const asset of assets.rows) {
      const calculation = await calculateDepreciation(
        asset.id,
        financialYear,
        periodStartDate,
        periodEndDate
      );

      if (calculation) {
        calculations.push(calculation);
      }
    }

    return calculations;
  } finally {
    client.release();
  }
}

/**
 * Save depreciation calculation to schedule
 */
export async function saveDepreciationSchedule(
  calculation: DepreciationCalculation,
  businessId: string,
  isPosted: boolean = false,
  journalEntryId?: string
): Promise<string> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insert or update depreciation schedule
    const result = await client.query(
      `INSERT INTO depreciation_schedule (
        business_id,
        asset_id,
        financial_year,
        period_start_date,
        period_end_date,
        opening_book_value,
        depreciation_amount,
        closing_book_value,
        is_posted,
        posted_date,
        journal_entry_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (asset_id, financial_year, period_start_date, period_end_date) 
      DO UPDATE SET
        opening_book_value = EXCLUDED.opening_book_value,
        depreciation_amount = EXCLUDED.depreciation_amount,
        closing_book_value = EXCLUDED.closing_book_value,
        is_posted = EXCLUDED.is_posted,
        posted_date = EXCLUDED.posted_date,
        journal_entry_id = EXCLUDED.journal_entry_id
      RETURNING id`,
      [
        businessId,
        calculation.asset_id,
        calculation.financial_year,
        calculation.period_start_date,
        calculation.period_end_date,
        calculation.opening_book_value,
        calculation.depreciation_amount,
        calculation.closing_book_value,
        isPosted,
        isPosted ? new Date().toISOString().split('T')[0] : null,
        journalEntryId || null,
      ]
    );

    // Update fixed asset's accumulated depreciation and current book value
    if (isPosted) {
      await client.query(
        `UPDATE fixed_assets
         SET accumulated_depreciation = accumulated_depreciation + $1,
             current_book_value = current_book_value - $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [calculation.depreciation_amount, calculation.asset_id]
      );
    }

    await client.query('COMMIT');
    return result.rows[0].id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get total depreciation for a financial year
 */
export async function getTotalDepreciation(
  businessId: string,
  financialYear: string
): Promise<number> {
  const result = await queryOne<{ total: number }>(
    `SELECT COALESCE(SUM(depreciation_amount), 0) as total
     FROM depreciation_schedule
     WHERE business_id = $1 
       AND financial_year = $2
       AND is_posted = true`,
    [businessId, financialYear]
  );

  return parseFloat(result?.total?.toString() || '0');
}

/**
 * Get fixed assets summary for Balance Sheet
 */
export async function getFixedAssetsSummary(
  businessId: string,
  asOnDate: string
): Promise<{
  grossBlock: number;
  accumulatedDepreciation: number;
  netBlock: number;
  assets: Array<{
    asset_id: string;
    asset_code: string;
    asset_name: string;
    purchase_cost: number;
    accumulated_depreciation: number;
    net_block: number;
  }>;
}> {
  const assets = await queryRows<{
    id: string;
    asset_code: string;
    asset_name: string;
    purchase_cost: number;
    accumulated_depreciation: number;
    current_book_value: number;
  }>(
    `SELECT 
      id,
      asset_code,
      asset_name,
      purchase_cost,
      accumulated_depreciation,
      current_book_value
    FROM fixed_assets
    WHERE business_id = $1 
      AND is_disposed = false
      AND purchase_date <= $2
    ORDER BY asset_code`,
    [businessId, asOnDate]
  );

  let grossBlock = 0;
  let accumulatedDepreciation = 0;
  let netBlock = 0;

  const assetDetails = assets.map((asset) => {
    const cost = parseFloat(asset.purchase_cost?.toString() || '0');
    const accDep = parseFloat(asset.accumulated_depreciation?.toString() || '0');
    const net = parseFloat(asset.current_book_value?.toString() || '0');

    grossBlock += cost;
    accumulatedDepreciation += accDep;
    netBlock += net;

    return {
      asset_id: asset.id,
      asset_code: asset.asset_code,
      asset_name: asset.asset_name,
      purchase_cost: cost,
      accumulated_depreciation: accDep,
      net_block: net,
    };
  });

  return {
    grossBlock,
    accumulatedDepreciation,
    netBlock,
    assets: assetDetails,
  };
}

