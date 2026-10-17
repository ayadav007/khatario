import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { assertGstr2bApiAccess } from '@/lib/gst/gstr2b-route-guard';
import { countPendingItc, type PendingRow } from '@/lib/gst/pending-itc';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gst/itc-decisions/pending?period=YYYY-MM
 * known has a count. not_imported and stale do not.
 */
export async function GET(request: NextRequest) {
  try {
    const period = new URL(request.url).searchParams.get('period');
    const openPeriod = period && /^\d{4}-\d{2}$/.test(period)
      ? period
      : new Date().toISOString().slice(0, 7);
    const access = await assertGstr2bApiAccess(request, null, 'read');
    if (!access.ok) return access.response;

    const pool = getPool();
    const [imported, status, rows] = await Promise.all([
      pool.query<{ ran: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM gstr2b_reconciliation WHERE business_id = $1 AND filing_period = $2
         ) AS ran`,
        [access.businessId, openPeriod]
      ),
      pool.query<{ state: string }>(
        `SELECT state FROM gst_period_status
          WHERE business_id = $1 AND kind = 'gstr2b' AND period_key = $2`,
        [access.businessId, openPeriod]
      ),
      pool.query<{
        match_status: string;
        decision: PendingRow['decision'];
        deferred_to_period: string | null;
        tax_difference: string;
      }>(
        `SELECT r.match_status, rd.decision, rd.deferred_to_period,
                (ABS(COALESCE(r.difference_igst, 0)) + ABS(COALESCE(r.difference_cgst, 0))
                 + ABS(COALESCE(r.difference_sgst, 0)) + ABS(COALESCE(r.difference_cess, 0)))::text AS tax_difference
           FROM gstr2b_reconciliation r
           LEFT JOIN LATERAL (
             SELECT decision, deferred_to_period
               FROM reconciliation_decisions
              WHERE reconciliation_id = r.id
              ORDER BY decision_date DESC, created_at DESC
              LIMIT 1
           ) rd ON true
          WHERE r.business_id = $1 AND r.filing_period = $2`,
        [access.businessId, openPeriod]
      ),
    ]);

    const result = countPendingItc({
      imported: imported.rows[0]?.ran === true,
      stale: status.rows[0]?.state === 'stale' || status.rows[0]?.state === 'awaiting_gstr2b',
      openPeriod,
      rows: rows.rows.map((row) => ({
        matchStatus: row.match_status,
        decision: row.decision,
        deferredToPeriod: row.deferred_to_period,
        taxDifference: Number(row.tax_difference) || 0,
      })),
    });

    if (result.state === 'known') {
      return NextResponse.json({ state: 'known', count: result.count, period: openPeriod });
    }
    return NextResponse.json({
      state: result.state,
      period: openPeriod,
      label: result.state === 'not_imported'
        ? 'GSTR-2B not imported'
        : 'Count is out of date — reconciliation has not been rerun',
    });
  } catch (error) {
    console.error('Pending ITC count failed:', error);
    return NextResponse.json({ error: 'Failed to count pending ITC decisions' }, { status: 500 });
  }
}
