/**
 * Period lock for closed inventory / closing stock snapshots.
 * When a snapshot is locked, documents dated on or before the latest locked
 * snapshot date should not be created or edited without an adjustment workflow.
 */

import { queryOne } from '@/lib/db';
import { hasClosingStockV2Schema } from '@/lib/closing-stock-schema';

export class ClosingStockPeriodLockedError extends Error {
  constructor(
    message: string,
    public readonly cutoffDate: string
  ) {
    super(message);
    this.name = 'ClosingStockPeriodLockedError';
  }
}

/** Latest locked snapshot date for the business (inclusive cutoff). */
export async function getClosingStockLockedCutoffDate(businessId: string): Promise<string | null> {
  if (await hasClosingStockV2Schema()) {
    const row = await queryOne<{ d: Date | string | null }>(
      `SELECT MAX(snapshot_date) AS d
       FROM closing_stock_snapshot_headers
       WHERE business_id = $1 AND is_locked = true`,
      [businessId]
    );
    if (!row?.d) return null;
    if (row.d instanceof Date) return row.d.toISOString().slice(0, 10);
    return String(row.d).slice(0, 10);
  }

  const legacy = await queryOne<{ d: Date | string | null }>(
    `SELECT MAX(css.snapshot_date) AS d
     FROM closing_stock_snapshots css
     INNER JOIN closing_stock_summary s
       ON s.business_id = css.business_id AND s.financial_year = css.financial_year
     WHERE css.business_id = $1 AND s.is_finalized = true`,
    [businessId]
  );
  if (!legacy?.d) return null;
  if (legacy.d instanceof Date) return legacy.d.toISOString().slice(0, 10);
  return String(legacy.d).slice(0, 10);
}

/**
 * @param documentDate ISO date string (YYYY-MM-DD)
 */
export function assertDocumentDateNotBeforeLockedClosingStock(
  documentDate: string,
  cutoff: string | null
): void {
  if (!cutoff) return;
  const doc = documentDate.slice(0, 10);
  if (doc <= cutoff) {
    throw new ClosingStockPeriodLockedError(
      `This date falls in a closed inventory period (closing stock locked through ${cutoff}). ` +
        `Use an inventory adjustment or contact an administrator.`,
      cutoff
    );
  }
}
