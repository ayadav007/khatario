import { NextRequest, NextResponse } from 'next/server';
import { getSessionScopedBusinessId, getUserFromRequest } from '@/lib/auth-helpers';
import { queryOne } from '@/lib/db';
import {
  insertInvoiceLearningEvent,
  mergeLearningInsertPayload,
} from '@/lib/services/invoice-extract/extractionLearningTelemetry';
import {
  buildCorrectionLogsFromPurchaseReviewDelta,
  insertInvoiceCorrectionLogs,
} from '@/lib/services/invoice-extract/invoiceCorrectionLogger';
import { getParserVersionMetadata } from '@/lib/services/invoice-extract/parserVersion';

/**
 * POST /api/invoices/extract/learning
 * Records aggregated correction summary after user accepts extraction review (no raw invoice blob).
 */
export async function POST(request: NextRequest) {
  const sessionBiz = getSessionScopedBusinessId(request);
  if (!sessionBiz) {
    return NextResponse.json({ error: 'Business scope required' }, { status: 401 });
  }

  let body: {
    job_id?: string;
    /** 'extraction_review_modal' | 'purchase_form_save' | custom */
    source?: string;
    correction_summary?: Record<string, unknown>;
    review_before?: { supplier?: unknown; invoice?: unknown; items?: unknown; totals?: unknown };
    review_after?: { supplier?: unknown; invoice?: unknown; items?: unknown; totals?: unknown };
    invoice_id?: string;
    user_id?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let userRow;
  try {
    userRow = await getUserFromRequest(request, body);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (userRow.business_id !== sessionBiz) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const jobId = body.job_id?.trim();
  if (!jobId) {
    return NextResponse.json({ error: 'job_id is required' }, { status: 400 });
  }

  const job = await queryOne<{ business_id: string }>(
    `SELECT business_id FROM invoice_extraction_jobs WHERE id = $1`,
    [jobId]
  );

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (job.business_id !== sessionBiz) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const metricsSource =
    typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'extraction_review_modal';

  const payload = mergeLearningInsertPayload(undefined, {
    source: metricsSource,
    parser_versions: getParserVersionMetadata(),
  });

  await insertInvoiceLearningEvent({
    businessId: sessionBiz,
    userId: userRow.id,
    extractionJobId: jobId,
    eventType: 'user_review_accept',
    payload,
    correctionSummary: body.correction_summary ?? null,
  });

  if (body.review_before && body.review_after) {
    const logs = buildCorrectionLogsFromPurchaseReviewDelta({
      businessId: sessionBiz,
      userId: userRow.id,
      extractionJobId: jobId,
      invoiceId: body.invoice_id?.trim() ?? null,
      parserVersions: getParserVersionMetadata(),
      before: body.review_before,
      after: body.review_after,
    });
    await insertInvoiceCorrectionLogs(logs);
  }

  return NextResponse.json({ ok: true });
}
