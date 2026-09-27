import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { reindex, summarizeReport } from '@/lib/rag/ingest/run';
import { purgeOldConversations } from '@/lib/rag/retention';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/cron/assistant-maintenance
 * Same work as the kb-index worker's nightly job, for servers that run cron instead of the worker:
 * re-index all knowledge sources, then delete conversations past the retention window.
 */
export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  try {
    const report = await reindex({ target: 'all' });
    const purged = await purgeOldConversations();
    return NextResponse.json({
      ok: report.errors.length === 0,
      summary: summarizeReport(report),
      purgedConversations: purged,
    });
  } catch (err) {
    console.error('[cron/assistant-maintenance] failed:', err);
    return NextResponse.json({ ok: false, error: 'Assistant maintenance failed' }, { status: 500 });
  }
}
