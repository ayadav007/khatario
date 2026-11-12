import { NextRequest, NextResponse } from 'next/server';
import { undoRun } from '@/lib/import/run';
import { badRequest, guardImportRequest, importFailure, isRunId, runColumnCount, runNotFound } from '@/lib/import/route-guard';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { section: string } }) {
  try {
    const guard = await guardImportRequest(request, params.section, 'create');
    if (!guard.ok) return guard.response;

    const body = await request.json().catch(() => null);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return badRequest();
    const runId = (body as { run_id?: unknown }).run_id;
    if (!isRunId(runId) || (await runColumnCount(guard.ctx, runId, guard.def)) === null) return runNotFound();

    return NextResponse.json(await undoRun(guard.ctx, runId));
  } catch (e) {
    return importFailure(e);
  }
}
