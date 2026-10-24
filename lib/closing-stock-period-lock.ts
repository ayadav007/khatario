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

/**
 * Calendar day for a DATE value. node-pg builds a Date at local midnight, so
 * `toISOString()` moves the day backward in timezones ahead of UTC (Asia/Kolkata).
 * Local year/month/day is the day Postgres stored. A `YYYY-MM-DD` string is kept as-is.
 */
export function calendarDateOnly(value: Date | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

/** Latest locked snapshot date for the business (inclusive cutoff), as YYYY-MM-DD. */
export async function getClosingStockLockedCutoffDate(businessId: string): Promise<string | null> {
  if (await hasClosingStockV2Schema()) {
    const row = await queryOne<{ d: string | null }>(
      `SELECT to_char(MAX(snapshot_date), 'YYYY-MM-DD') AS d
       FROM closing_stock_snapshot_headers
       WHERE business_id = $1 AND is_locked = true`,
      [businessId]
    );
    return calendarDateOnly(row?.d ?? null);
  }

  const legacy = await queryOne<{ d: string | null }>(
    `SELECT to_char(MAX(css.snapshot_date), 'YYYY-MM-DD') AS d
     FROM closing_stock_snapshots css
     INNER JOIN closing_stock_summary s
       ON s.business_id = css.business_id AND s.financial_year = css.financial_year
     WHERE css.business_id = $1 AND s.is_finalized = true`,
    [businessId]
  );
  return calendarDateOnly(legacy?.d ?? null);
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
