import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';

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

    let totalMs = 0;
    let completed = 0;
    for (const j of jobs) {
      if (j.status === 'completed') completed += 1;
      totalMs += Number(j.processing_time_ms) || 0;
    }

    const minutesFromProcessing = totalMs / 60000;
    /** Rough “typing time saved”: ~5 min per completed extract minus extraction time — kept simple for UX */
    const minutesSavedApprox = Math.max(
      0,
      Math.round(completed * 5 - minutesFromProcessing + minutesFromProcessing * 0.2)
    );

    return NextResponse.json({
      jobs,
      stats: {
        billsScanned: jobs.length,
        completedJobs: completed,
        minutesSavedApprox: Math.max(minutesSavedApprox, jobs.length > 0 ? 1 : 0),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[GET /api/invoices/extract/jobs]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
