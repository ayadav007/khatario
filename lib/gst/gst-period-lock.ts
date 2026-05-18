import { queryOne } from '@/lib/db';

/** Indian financial year label e.g. April 2026 → 2026-27 */
export function indianFinancialYearLabel(year: number, month: number): string {
  if (month >= 4) {
    return `${year}-${String(year + 1).slice(-2)}`;
  }
  return `${year - 1}-${String(year).slice(-2)}`;
}

export function calendarMonthBounds(periodYYYYMM: string): {
  start: string;
  end: string;
  financialYear: string;
} {
  const m = /^(\d{4})-(\d{2})$/.exec(periodYYYYMM.trim());
  if (!m) {
    throw new Error('Invalid gst_period; expected YYYY-MM');
  }
  const y = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) {
    throw new Error('Invalid gst_period; expected YYYY-MM');
  }
  const start = `${y}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(y, month, 0).getDate();
  const end = `${y}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return {
    start,
    end,
    financialYear: indianFinancialYearLabel(y, month),
  };
}

export interface LockGstPeriodParams {
  businessId: string;
  branchId: string;
  /** Calendar month YYYY-MM */
  period: string;
  lockedBy?: string | null;
  notes?: string;
}

export interface LockGstPeriodResult {
  locked: boolean;
  warning?: string;
}

/**
 * Lock the calendar month in `period_locks` (same shape as POST /api/period-locks).
 * Used after GST settlement so invoice/purchase flows respect `assertPeriodNotLocked`.
 */
export async function lockGstPeriod(params: LockGstPeriodParams): Promise<LockGstPeriodResult> {
  let start: string;
  let end: string;
  let financialYear: string;
  try {
    const b = calendarMonthBounds(params.period);
    start = b.start;
    end = b.end;
    financialYear = b.financialYear;
  } catch (e: any) {
    return { locked: false, warning: e?.message || 'Invalid GST period for lock' };
  }

  try {
    await queryOne(
      `
      INSERT INTO period_locks (
        business_id, branch_id, financial_year, period_start, period_end,
        is_locked, locked_by, notes
      )
      VALUES ($1, $2::uuid, $3, $4::date, $5::date, true, $6::uuid, $7)
      ON CONFLICT (business_id, branch_id, financial_year, period_start, period_end)
      DO UPDATE SET
        is_locked = true,
        locked_by = COALESCE(EXCLUDED.locked_by, period_locks.locked_by),
        notes = COALESCE(EXCLUDED.notes, period_locks.notes),
        locked_at = CASE WHEN EXCLUDED.is_locked THEN CURRENT_TIMESTAMP ELSE period_locks.locked_at END,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
      `,
      [
        params.businessId,
        params.branchId,
        financialYear,
        start,
        end,
        params.lockedBy ?? null,
        params.notes ?? 'Locked after GST settlement',
      ]
    );
    return { locked: true };
  } catch (e: any) {
    return { locked: false, warning: e?.message || 'Failed to create period lock' };
  }
}
