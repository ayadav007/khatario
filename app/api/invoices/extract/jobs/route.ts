import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryOne, queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { MANUAL_BILL_ENTRY_MINUTES } from '@/lib/purchase-scan-constants';

export const dynamic = 'force-dynamic';

export type ExtractionJobListRow = {
  id: string;
  business_id: string;
  file_name: string;
  file_type: string | null;
  status: string;
  extraction_data: unknown;
  processing_time_ms: number | null;
  created_at: string;
  extracted_at: string | null;
};

/**
 * GET /api/invoices/extract/jobs?limit=50
 * Lists recent invoice extraction jobs for the active business.
 */
export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 50) || 50));

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    try {
      await authorize(userId, 'purchases', 'read', { businessId });
    } catch (e) {
      if (e instanceof AuthorizationError) return e.toNextResponse();
      throw e;
    }

    const jobs = await queryRows<ExtractionJobListRow>(
      `SELECT id, business_id, file_name, file_type, status, extraction_data,
              processing_time_ms, created_at, extracted_at
         FROM invoice_extraction_jobs
        WHERE business_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [businessId, limit]
    );

    const countRow = await queryOne<{ completed_count: number }>(
      `SELECT COUNT(*)::int AS completed_count
         FROM invoice_extraction_jobs
        WHERE business_id = $1
          AND status = 'completed'`,
      [businessId]
    );
    const completedCount = countRow?.completed_count ?? 0;
    const minutesSaved = completedCount * MANUAL_BILL_ENTRY_MINUTES;

    return NextResponse.json({
      jobs,
      stats: {
        billsScanned: completedCount,
        completedJobs: completedCount,
        minutesSaved,
        /** @deprecated use minutesSaved — kept for older clients */
        minutesSavedApprox: minutesSaved,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[GET /api/invoices/extract/jobs]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
