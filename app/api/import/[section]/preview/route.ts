import { NextRequest, NextResponse } from 'next/server';
import { previewRun } from '@/lib/import/run';
import { badRequest, guardImportRequest, importFailure, isRunId, runColumnCount, runNotFound } from '@/lib/import/route-guard';
import type { ColumnMatches, SectionDefinition } from '@/lib/import/types';

export const dynamic = 'force-dynamic';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keys are column positions inside the file's header count; values a field of the section or null. */
function parseColumnMatches(raw: unknown, def: SectionDefinition, columnCount: number): ColumnMatches | null {
  if (!isObject(raw)) return null;
  const fieldKeys = new Set(def.fields.map((f) => f.key));
  const out: ColumnMatches = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^\d+$/.test(k) || Number(k) >= columnCount) return null;
    if (v !== null && !(typeof v === 'string' && fieldKeys.has(v))) return null;
    out[Number(k)] = v as string | null;
  }
  return out;
}

function parseValueMatches(raw: unknown): Record<string, Record<string, string>> | null {
  if (!isObject(raw)) return null;
  const out: Record<string, Record<string, string>> = {};
  for (const [field, map] of Object.entries(raw)) {
    if (!isObject(map)) return null;
    out[field] = {};
    for (const [from, to] of Object.entries(map)) {
      if (typeof to !== 'string') return null;
      out[field][from] = to;
    }
  }
  return out;
}

export async function POST(request: NextRequest, { params }: { params: { section: string } }) {
  try {
    const guard = await guardImportRequest(request, params.section, 'create');
    if (!guard.ok) return guard.response;

    const body = await request.json().catch(() => null);
    if (!isObject(body)) return badRequest();
    if (!isRunId(body.run_id)) return runNotFound();
    const columnCount = await runColumnCount(guard.ctx, body.run_id, guard.def);
    if (columnCount === null) return runNotFound();
    const columnMatches = parseColumnMatches(body.column_matches, guard.def, columnCount);
    const valueMatches = parseValueMatches(body.value_matches ?? {});
    if (!columnMatches || !valueMatches || (body.date_order !== 'dmy' && body.date_order !== 'mdy')) return badRequest();

    const result = await previewRun(guard.ctx, body.run_id, {
      columnMatches,
      valueMatches,
      dateOrder: body.date_order,
    });
    return NextResponse.json(result);
  } catch (e) {
    return importFailure(e);
  }
}
