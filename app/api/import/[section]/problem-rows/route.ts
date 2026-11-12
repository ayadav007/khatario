import { NextRequest, NextResponse } from 'next/server';
import { problemRowsCsv } from '@/lib/import/run';
import { guardImportRequest, importFailure, isRunId, runColumnCount, runNotFound } from '@/lib/import/route-guard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { section: string } }) {
  try {
    const guard = await guardImportRequest(request, params.section, 'read');
    if (!guard.ok) return guard.response;

    const runId = new URL(request.url).searchParams.get('run_id');
    if (!isRunId(runId) || (await runColumnCount(guard.ctx, runId, guard.def)) === null) return runNotFound();

    // The BOM lets Excel read Hindi and other non-ASCII text as UTF-8.
    const csv = '﻿' + (await problemRowsCsv(guard.ctx, runId));
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="import-problems.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return importFailure(e);
  }
}
