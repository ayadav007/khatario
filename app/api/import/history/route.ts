import { NextRequest, NextResponse } from 'next/server';
import { listRuns, type RunSummary } from '@/lib/import/run';
import { guardImportRequest, guardImportSession, importFailure, readableSections } from '@/lib/import/route-guard';

export const dynamic = 'force-dynamic';

const HISTORY_LIMIT = 50;

export async function GET(request: NextRequest) {
  try {
    const section = new URL(request.url).searchParams.get('section');
    if (section) {
      const guard = await guardImportRequest(request, section, 'read');
      if (!guard.ok) return guard.response;
      return NextResponse.json({ runs: await listRuns(guard.ctx, guard.def.key) });
    }

    // No section: the runs of every module the user can read, newest first.
    const guard = await guardImportSession(request);
    if (!guard.ok) return guard.response;
    const runs: RunSummary[] = [];
    for (const key of await readableSections(guard.ctx)) runs.push(...(await listRuns(guard.ctx, key)));
    runs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return NextResponse.json({ runs: runs.slice(0, HISTORY_LIMIT) });
  } catch (e) {
    return importFailure(e);
  }
}
