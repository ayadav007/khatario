/**
 * Period Lock Utilities
 * Functions to check and validate period locks
 */

import { queryOne } from './db';

/**
 * GST return in `revised` status reopens the books for that calendar month even if
 * `period_locks` still shows locked (set-off / post-file lock).
 */
async function isGstMonthInRevisionWindow(
  businessId: string,
  branchId: string | null,
  dateStr: string
): Promise<boolean> {
  if (!branchId || dateStr.length < 7) {
    return false;
  }
  const gstPeriod = dateStr.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(gstPeriod)) {
    return false;
  }
  const row = await queryOne<{ id: string }>(
    `
    SELECT id
    FROM gst_filings
    WHERE business_id = $1::uuid
      AND gst_period = $2
      AND status = 'revised'
      AND (branch_id IS NULL OR branch_id = $3::uuid)
    LIMIT 1
    `,
    [businessId, gstPeriod, branchId]
  );
  return !!row;
}

/**
 * Check if a period is locked for a given business and branch
 */
export async function isPeriodLocked(
  businessId: string,
  branchId: string | null,
  entryDate: Date | string
): Promise<boolean> {
  try {
    const date = typeof entryDate === 'string' ? new Date(entryDate) : entryDate;
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Check for branch-specific lock first
    if (branchId) {
      const branchLock = await queryOne<{ is_locked: boolean }>(`
        SELECT is_locked
        FROM period_locks
        WHERE business_id = $1
          AND branch_id = $2
          AND $3::DATE BETWEEN period_start AND period_end
          AND is_locked = true
        LIMIT 1
      `, [businessId, branchId, dateStr]);

      if (branchLock?.is_locked) {
        if (await isGstMonthInRevisionWindow(businessId, branchId, dateStr)) {
          return false;
        }
        return true;
      }
    }

    // Check for business-wide lock (branch_id IS NULL)
    const businessLock = await queryOne<{ is_locked: boolean }>(`
      SELECT is_locked
      FROM period_locks
      WHERE business_id = $1
        AND branch_id IS NULL
        AND $2::DATE BETWEEN period_start AND period_end
        AND is_locked = true
      LIMIT 1
    `, [businessId, dateStr]);

    if (businessLock?.is_locked) {
      if (branchId && (await isGstMonthInRevisionWindow(businessId, branchId, dateStr))) {
        return false;
      }
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error checking period lock:', error);
    // Fail closed: treat as locked when we cannot verify
    return true;
  }
}

/**
 * Assert that a period is not locked (throws error if locked)
 */
export async function assertPeriodNotLocked(
  businessId: string,
  branchId: string | null,
  entryDate: Date | string,
  transactionType: string = 'transaction'
): Promise<void> {
  const locked = await isPeriodLocked(businessId, branchId, entryDate);
  
  if (locked) {
    const date = typeof entryDate === 'string' ? entryDate : entryDate.toISOString().split('T')[0];
    throw new Error(
      `Cannot create ${transactionType} in locked period. Entry date: ${date}, Business: ${businessId}, Branch: ${branchId || 'All branches'}`
    );
  }
}
